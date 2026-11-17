import { createReadStream } from "node:fs";
import { Actor, log } from "apify";
import {
  authHeaders,
  downloadToFile,
  MediaError,
  saveStream,
} from "./download.js";
import { Ffmpeg } from "./ffmpeg.js";
import {
  InputError,
  isAudioFormat,
  normalizeInput,
  type RawInput,
} from "./input.js";
import { EVENTS, type EventName } from "./plan.js";
import { runConversions } from "./run.js";

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
  const cpus = memoryMb / 4096;
  const threads = Math.max(1, Math.floor(cpus));
  log.info(
    `${input.sources.length} file(s) to ${input.outputFormat}` +
      (isAudioFormat(input.outputFormat)
        ? ""
        : `, max ${input.maxHeight}p` +
          (input.targetBytes
            ? `, target ${input.targetBytes / 1024 / 1024} MB`
            : `, crf ${input.crf}`) +
          (input.mute ? ", muted" : "")) +
      (input.startSecs ? `, from ${input.startSecs} s` : "") +
      (input.durationSecs ? `, ${input.durationSecs} s long` : "") +
      `, max ${input.maxDurationSecs / 60} min per file, ${threads} thread(s).`,
  );

  const charging = Actor.getChargingManager();
  const ppe = charging.getPricingInfo().isPayPerEvent;
  const prices = charging.getPricingInfo().perEventPrices;
  // Events not priced in the Console are free.
  const priced = (event: EventName) => ppe && !!prices[event];
  const canCharge = (event: EventName, count: number) =>
    !priced(event) ||
    charging.calculateMaxEventChargeCountWithinLimit(event) >= count;
  const cheapest = isAudioFormat(input.outputFormat)
    ? EVENTS.audio
    : EVENTS.p480;
  if (!canCharge(cheapest, 1)) {
    log.warning("Max charge per run is too low for a single minute.");
    await Actor.exit();
  }

  const token = Actor.config.get("token");
  const store = await Actor.openKeyValueStore();
  const limits = { maxBytes: input.maxBytes, timeoutMs: input.timeoutMs };
  const stats = await runConversions(input, {
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
        throw new MediaError(
          `Reading record "${job.input}" failed: ${(e as Error).message}`,
        );
      }
      if (!record)
        throw new MediaError(
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
    media: new Ffmpeg(),
    threads,
    cpus,
    canCharge,
    // Streamed, so a large video is never held in memory.
    saveFile: async (key, path, contentType) => {
      await store.setValue(key, createReadStream(path), { contentType });
      return store.getPublicUrl(key);
    },
    deleteFile: (key) => store.setValue(key, null),
    // Charge first, then push, so a file is never delivered unpaid.
    // Failures are free.
    emit: async (item, charge) => {
      if (!charge || !priced(charge.event)) {
        await Actor.pushData(item);
        return { pushed: true, more: true };
      }
      const stop = { pushed: false, more: false };
      // Never ask for more than the budget allows (the SDK would overcharge
      // to end the run). run.ts already skipped files over the budget.
      if (!canCharge(charge.event, charge.count)) return stop;
      const res = await Actor.charge({
        eventName: charge.event,
        count: charge.count,
      });
      if (res.chargedCount < charge.count) {
        // Only a concurrent charge could get here: deliver what was paid
        // for (at least part of it), then stop.
        if (res.chargedCount < 1) return stop;
        await Actor.pushData(item);
        return { pushed: true, more: false };
      }
      await Actor.pushData(item);
      return { pushed: true, more: canCharge(cheapest, 1) };
    },
    log: (m) => log.info(m),
  });

  log.info(`Done: ${JSON.stringify(stats)}`);
  const minutes = Object.entries(stats.minutes)
    .map(([event, n]) => `${n} ${event}`)
    .join(", ");
  const saved =
    stats.bytesIn > 0
      ? `, ${Math.round((1 - stats.bytesOut / stats.bytesIn) * 100)}% smaller`
      : "";
  await Actor.setStatusMessage(
    `Converted ${stats.converted} file(s)` +
      (minutes ? ` (${minutes})` : "") +
      saved +
      (stats.failed ? `, ${stats.failed} failed` : "") +
      (stats.stopReason === "budget" ? " (max charge reached)" : ""),
    { isStatusMessageTerminal: true },
  );
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
