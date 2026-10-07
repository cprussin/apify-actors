import { Actor, log } from "apify";
import {
  authHeaders,
  downloadToFile,
  fetchText,
  MediaError,
  saveStream,
} from "./download.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { runTranscriptions } from "./run.js";
import { Seen, stateKey } from "./state.js";
import { PythonWorker } from "./worker.js";

/** One event per started minute of transcribed audio, priced per model. */
export const minuteEvent = (model: string) => `audio-minute-${model}`;
/** Named (persistent) key-value store holding onlyNewEpisodes state. */
export const STATE_STORE = "media-transcriber-state";
const MAX_FEED_BYTES = 20 * 1024 * 1024;

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
  const threads = Math.max(1, Math.floor(memoryMb / 4096));
  log.info(
    `${input.sources.length} file(s)/feed(s), model ${input.model}, language ${input.language ?? "auto"}, ${input.outputFormat}` +
      (input.onlyNewEpisodes ? ", only new episodes" : "") +
      `, max ${input.maxDurationSecs / 60} min per file, ${threads} thread(s).`,
  );

  const event = minuteEvent(input.model);
  const charging = Actor.getChargingManager();
  const ppe = charging.getPricingInfo().isPayPerEvent;
  const left = () => charging.calculateMaxEventChargeCountWithinLimit(event);
  if (ppe && left() <= 0) {
    log.warning("Max charge per run is too low for a single minute of audio.");
    await Actor.exit();
  }

  // onlyNewEpisodes: state is keyed by the feeds, so each distinct input
  // (e.g. each scheduled task) tracks its own "already transcribed" episodes.
  let seen: Seen | undefined;
  let saveState: (() => Promise<void>) | undefined;
  const feeds = input.sources.filter((s) => s.kind === "feed");
  if (input.onlyNewEpisodes && feeds.length) {
    const stateStore = await Actor.openKeyValueStore(STATE_STORE);
    const key = stateKey({ feeds: feeds.map((s) => s.url).sort() });
    const s = new Seen(await stateStore.getValue(key));
    seen = s;
    saveState = () => stateStore.setValue(key, s.toJSON());
    log.info(
      `Only new episodes: state "${key}" in store "${STATE_STORE}" (${s.size} known).`,
    );
  }

  const token = Actor.config.get("token");
  const store = await Actor.openKeyValueStore();
  const limits = { maxBytes: input.maxBytes, timeoutMs: input.timeoutMs };
  const stats = await runTranscriptions(input, {
    fetchFeed: (url) =>
      fetchText(url, {
        maxBytes: MAX_FEED_BYTES,
        timeoutMs: Math.min(input.timeoutMs, 60_000),
      }),
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
    transcribe: worker.transcribe,
    budgetMinutes: () => (ppe ? left() : Infinity),
    saveFile: async (key, text, contentType) => {
      await store.setValue(key, text, { contentType });
      return store.getPublicUrl(key);
    },
    // Charge first, then push, so a transcript is never delivered unpaid.
    // Failures are free.
    emit: async (items, minutes) => {
      if (!ppe || minutes === 0) {
        await Actor.pushData(items);
        return { pushed: true, more: true };
      }
      const stop = { pushed: false, more: false };
      // Never ask for more than the budget allows (the SDK would overcharge
      // to end the run). The worker already refused longer files.
      if (left() < minutes) return stop;
      const res = await Actor.charge({ eventName: event, count: minutes });
      if (res.chargedCount < 1) return stop;
      await Actor.pushData(items);
      return { pushed: true, more: left() >= 1 };
    },
    seen,
    saveState,
    threads,
    log: (m) => log.info(m),
  }).finally(() => saveState?.());

  log.info(`Done: ${JSON.stringify(stats)}`);
  await Actor.setStatusMessage(
    `Transcribed ${stats.transcribed} file(s), ${stats.billedMinutes} min` +
      (stats.failed ? `, ${stats.failed} failed` : "") +
      (stats.skippedSeen
        ? `, ${stats.skippedSeen} episode(s) done in earlier runs`
        : "") +
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
