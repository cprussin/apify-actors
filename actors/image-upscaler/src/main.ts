import { readFile } from "node:fs/promises";
import { Actor, log } from "apify";
import {
  authHeaders,
  downloadToFile,
  ImageError,
  saveStream,
} from "./download.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { runUpscales } from "./run.js";
import { PythonWorker } from "./worker.js";

/** One event per started half megapixel of input (see run.ts). */
export const EVENT = "image-upscaled";
/** CPU seconds per input megapixel, measured on one core, with headroom. */
const CPU_SECS_PER_MP = 150;

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
  // Apify gives one CPU core per 4 GB of memory.
  const memoryMb = Number(process.env.ACTOR_MEMORY_MBYTES) || 4096;
  const cores = memoryMb / 4096;
  const threads = Math.max(1, Math.floor(cores));
  log.info(
    `${input.sources.length} image(s), ${input.scale}x to ${input.outputFormat}, max ${input.maxInputPixels / 1e6} MP input, ${threads} thread(s).`,
  );

  const charging = Actor.getChargingManager();
  const ppe = charging.getPricingInfo().isPayPerEvent;
  const left = () => charging.calculateMaxEventChargeCountWithinLimit(EVENT);
  if (ppe && left() <= 0) {
    log.warning("Max charge per run is too low for a single image.");
    await Actor.exit();
  }

  const token = Actor.config.get("token");
  const store = await Actor.openKeyValueStore();
  const limits = { maxBytes: input.maxBytes, timeoutMs: input.timeoutMs };
  const stats = await runUpscales(input, {
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
        throw new ImageError(
          `Reading record "${job.input}" failed: ${(e as Error).message}`,
        );
      }
      if (!record)
        throw new ImageError(
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
    probe: worker.probe,
    upscale: worker.upscale,
    budgetUnits: () => (ppe ? left() : Infinity),
    saveFile: async (key, path, contentType) => {
      await store.setValue(key, await readFile(path), { contentType });
      return store.getPublicUrl(key);
    },
    deleteFile: (key) => store.setValue(key, null),
    // Charge first, then push, so an image is never delivered unpaid.
    // Failures are free.
    emit: async (item, units) => {
      if (!ppe || units === 0) {
        await Actor.pushData(item);
        return { pushed: true, more: true };
      }
      const stop = { pushed: false, more: false };
      // Never ask for more than the budget allows (the SDK would overcharge
      // to end the run). run.ts already skipped images over the budget.
      if (left() < units) return stop;
      const res = await Actor.charge({ eventName: EVENT, count: units });
      if (res.chargedCount < 1) return stop;
      await Actor.pushData(item);
      return { pushed: true, more: left() >= 1 };
    },
    threads,
    timeoutMs: (pixels) =>
      Math.round(
        (60 + (CPU_SECS_PER_MP * pixels) / 1e6 / Math.min(cores, threads)) *
          1000,
      ),
    log: (m) => log.info(m),
  });

  log.info(`Done: ${JSON.stringify(stats)}`);
  await Actor.setStatusMessage(
    `Upscaled ${stats.upscaled} image(s), ${stats.inputMegapixels} MP in, ${stats.billedUnits} event(s)` +
      (stats.failed ? `, ${stats.failed} failed` : "") +
      (stats.stopReason === "budget" ? " (max charge reached)" : ""),
    { isStatusMessageTerminal: true },
  );
  worker.close();
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  worker.close();
  await Actor.fail((e as Error).message);
}
