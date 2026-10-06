import { Actor, log } from "apify";
import { PythonWorker } from "./converter.js";
import { authHeaders, DocumentError, download } from "./download.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { runConversions } from "./run.js";

export const DOCUMENT_EVENT = "document-converted";
export const OCR_EVENT = "ocr-page";

await Actor.init();

const worker = new PythonWorker(undefined, undefined, (m) => log.warning(m));
try {
  const raw = await Actor.getInput<RawInput>();
  let input;
  try {
    input = normalizeInput(raw);
  } catch (e) {
    if (e instanceof InputError) {
      await Actor.fail(`Invalid input: ${e.message}`);
    }
    throw e;
  }
  log.info(
    `${input.sources.length} document(s) -> ${input.outputFormat}` +
      (input.outputFormat === "chunks"
        ? ` (${input.chunkSize} chars, ${input.chunkOverlap} overlap)`
        : "") +
      `, OCR ${input.ocr ? `on (${input.ocrLanguage}, max ${input.maxOcrPagesPerDocument} pages/doc)` : "off"}` +
      `, max ${input.maxBytes / 1024 / 1024} MB per file.`,
  );

  const charging = Actor.getChargingManager();
  const pricing = charging.getPricingInfo();
  const ppe = pricing.isPayPerEvent;
  const left = (event: string) =>
    charging.calculateMaxEventChargeCountWithinLimit(event);
  if (ppe && left(DOCUMENT_EVENT) <= 0) {
    log.warning("Max charge per run is too low for a single document.");
    await Actor.exit();
  }

  const token = Actor.config.get("token");
  const store = await Actor.openKeyValueStore();
  const stats = await runConversions(input, {
    fetch: async (s) => {
      if (s.kind === "url")
        return download(s.url, {
          maxBytes: input.maxBytes,
          timeoutMs: input.timeoutMs,
          headers: authHeaders(s.url, token),
        });
      // The API client reads by ID or "username~store-name" and, unlike
      // Actor.openKeyValueStore, never creates a store for a typo.
      let record;
      try {
        record = await Actor.apifyClient
          .keyValueStore(s.store)
          .getRecord(s.key, { buffer: true });
      } catch (e) {
        throw new DocumentError(
          `Reading record "${s.input}" failed: ${(e as Error).message}`,
        );
      }
      if (!record)
        throw new DocumentError(
          `Record "${s.key}" not found in key-value store "${s.store}".`,
        );
      if (record.value.length > input.maxBytes)
        throw new DocumentError(
          `The file is larger than the ${input.maxBytes / 1024 / 1024} MB limit (maxFileSizeMb).`,
        );
      return {
        body: record.value,
        contentType: record.contentType ?? null,
        fileName: s.key,
      };
    },
    convert: worker.convert,
    canConvert: () => !ppe || left(DOCUMENT_EVENT) >= 1,
    ocrBudget: () => {
      if (!ppe) return Infinity;
      const docPrice = pricing.perEventPrices[DOCUMENT_EVENT] ?? 0;
      const ocrPrice = pricing.perEventPrices[OCR_EVENT] ?? 0;
      if (!ocrPrice) return Infinity;
      // Keep room for the document event itself.
      return left(OCR_EVENT) - Math.ceil(docPrice / ocrPrice);
    },
    saveContent: async (key, text, contentType) => {
      await store.setValue(key, text, { contentType });
      return store.getPublicUrl(key);
    },
    // Charge first, then push, so a document is never delivered unpaid and
    // the run stops at ACTOR_MAX_TOTAL_CHARGE_USD. Failures are free.
    emit: async (items, charge) => {
      if (!ppe || !charge.document) {
        await Actor.pushData(items);
        return { pushed: true, more: true };
      }
      const stop = { pushed: false, more: false };
      if (left(DOCUMENT_EVENT) < 1) return stop;
      const res = await Actor.charge({ eventName: DOCUMENT_EVENT });
      if (res.chargedCount < 1) return stop;
      // Never ask for more OCR pages than the budget allows (the SDK would
      // overcharge by one to end the run).
      const ocr = Math.min(charge.ocrPages, left(OCR_EVENT));
      if (ocr > 0) await Actor.charge({ eventName: OCR_EVENT, count: ocr });
      await Actor.pushData(items);
      return { pushed: true, more: left(DOCUMENT_EVENT) >= 1 };
    },
    log: (m) => log.warning(m),
  });

  log.info(`Done: ${JSON.stringify(stats)}`);
  await Actor.setStatusMessage(
    `Converted ${stats.converted} of ${input.sources.length} document(s)` +
      (stats.ocrPages ? `, ${stats.ocrPages} OCR page(s)` : "") +
      (stats.failed ? `, ${stats.failed} failed` : "") +
      (stats.stopReason === "budget" ? " (stopped at max charge)" : ""),
    { isStatusMessageTerminal: true },
  );
  worker.close();
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  worker.close();
  await Actor.fail((e as Error).message);
}
