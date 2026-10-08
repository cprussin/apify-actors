import { readFile } from "node:fs/promises";
import { Actor, log } from "apify";
import {
  authHeaders,
  downloadToFile,
  saveStream,
  VideoError,
} from "./download.js";
import { Ffmpeg } from "./ffmpeg.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import {
  costUsd,
  EVENTS,
  formatUsd,
  type Charges,
  type EventName,
} from "./plan.js";
import { runExtraction } from "./run.js";

await Actor.init();

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
  // Apify gives one CPU core per 4 GB of memory.
  const memoryMb = Number(process.env.ACTOR_MEMORY_MBYTES) || 4096;
  const threads = Math.max(1, Math.floor(memoryMb / 4096));
  log.info(
    `${input.sources.length} video(s), mode ${input.mode}, ${input.frameFormat} frames` +
      (input.contactSheetColumns ? ", contact sheet" : "") +
      (input.gif ? ", GIF clip" : "") +
      (input.audioFormat ? `, ${input.audioFormat} audio` : "") +
      `, max ${input.maxDurationSecs / 60} min per video, ${threads} thread(s).`,
  );

  const charging = Actor.getChargingManager();
  const pricing = charging.getPricingInfo();
  const ppe = pricing.isPayPerEvent;
  const prices = ppe ? pricing.perEventPrices : {};
  // Every priced event, including any the SDK charges by itself, or what
  // this run asked to charge if more (the SDK's local mode under-counts).
  let requestedUsd = 0;
  const spentUsd = () =>
    Math.max(
      requestedUsd,
      Object.entries(pricing.perEventPrices).reduce(
        (usd, [event, p]) => usd + charging.getChargedEventCount(event) * p,
        0,
      ),
    );
  const budgetUsd = () =>
    ppe ? Math.max(0, pricing.maxTotalChargeUsd - spentUsd()) : Infinity;
  const minUsd = prices[EVENTS.video] ?? 0;
  if (ppe && budgetUsd() + 1e-9 < minUsd) {
    log.warning("Max charge per run is too low for a single video.");
    await Actor.exit();
  }

  const token = Actor.config.get("token");
  const store = await Actor.openKeyValueStore();
  const limits = { maxBytes: input.maxBytes, timeoutMs: input.timeoutMs };
  const stats = await runExtraction(input, {
    download: async (job, path) => {
      if (job.kind !== "kv")
        return downloadToFile(job.url, path, {
          ...limits,
          headers: authHeaders(job.url, token),
        });
      // The API client reads by ID or "username~store-name" and, unlike
      // Actor.openKeyValueStore, never creates a store for a typo.
      let record;
      try {
        record = await Actor.apifyClient
          .keyValueStore(job.store)
          .getRecord(job.key, { stream: true });
      } catch (e) {
        throw new VideoError(
          `Reading record "${job.input}" failed: ${(e as Error).message}`,
        );
      }
      if (!record)
        throw new VideoError(
          `Record "${job.key}" not found in key-value store "${job.store}".`,
        );
      const { bytes, head } = await saveStream(
        record.value,
        path,
        input.maxBytes,
      );
      return {
        path,
        bytes,
        head,
        contentType: record.contentType ?? null,
        fileName: job.key,
      };
    },
    media: new Ffmpeg(threads),
    prices,
    budgetUsd,
    saveFile: async (key, path, contentType) => {
      await store.setValue(key, await readFile(path), { contentType });
      return store.getPublicUrl(key);
    },
    deleteFile: (key) => store.setValue(key, null),
    // Charge first, then push, so outputs are never delivered unpaid.
    // Failures are free. run.ts checked the budget before the work.
    emit: async (item, charges: Charges) => {
      // Events not priced in the Console are free.
      const events = Object.entries(charges).filter(
        ([e, n]) => n && prices[e],
      ) as [EventName, number][];
      if (!ppe || !events.length) {
        await Actor.pushData(item);
        return { pushed: true, more: true };
      }
      // Never ask for more than the budget allows (the SDK would overcharge
      // to end the run).
      if (budgetUsd() + 1e-9 < costUsd(charges, prices))
        return { pushed: false, more: false };
      const before = spentUsd();
      for (const [eventName, count] of events)
        await Actor.charge({ eventName, count });
      requestedUsd = before + costUsd(charges, prices);
      await Actor.pushData(item);
      return { pushed: true, more: budgetUsd() + 1e-9 >= minUsd };
    },
    log: (m) => log.info(m),
  });

  log.info(`Done: ${JSON.stringify(stats)}`);
  await Actor.setStatusMessage(
    `Processed ${stats.processed} video(s), ${stats.frames} frame(s)` +
      (stats.sceneMinutes ? `, ${stats.sceneMinutes} scene minute(s)` : "") +
      (stats.extras ? `, ${stats.extras} GIF/audio event(s)` : "") +
      (stats.audioMinutes
        ? `, ${stats.audioMinutes} re-encoded audio minute(s)`
        : "") +
      (ppe ? `, ${formatUsd(stats.chargedUsd)}` : "") +
      (stats.failed ? `, ${stats.failed} failed` : "") +
      (stats.stopReason === "budget" ? " (max charge reached)" : ""),
    { isStatusMessageTerminal: true },
  );
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
