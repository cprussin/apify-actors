import { Actor, log } from "apify";
import sharp from "sharp";
import { sampleImage } from "./convert.js";
import {
  authHeaders,
  downloadToFile,
  ImageError,
  saveStream,
} from "./download.js";
import { decodeHeic } from "./heic.js";
import {
  buildSources,
  imageUrlsFromItem,
  InputError,
  MAX_SOURCES,
  normalizeInput,
  SAMPLE,
  type RawInput,
} from "./input.js";
import { EVENTS, runConversions, type EventName } from "./run.js";

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

  // Image URLs from another run's dataset (e.g. a scraper's image field).
  if (input.dataset) {
    const { id, field } = input.dataset;
    const urls: string[] = [];
    const room = MAX_SOURCES - input.sources.length;
    try {
      const client = Actor.apifyClient.dataset(id);
      for (let offset = 0; urls.length < room;) {
        const page = await client.listItems({
          offset,
          limit: 1000,
          fields: [field.split(".")[0]!],
        });
        for (const item of page.items)
          urls.push(...imageUrlsFromItem(item, field));
        offset += page.items.length;
        if (!page.items.length || offset >= page.total) break;
      }
    } catch (e) {
      await Actor.fail(
        `Invalid input: reading dataset "${id}" failed: ${(e as Error).message}`,
      );
    }
    if (urls.length > room)
      log.warning(
        `The dataset has more than ${room} image URLs; only the first ${room} are converted (at most ${MAX_SOURCES} images per run).`,
      );
    if (!urls.length)
      log.warning(
        `No image URLs found in field "${field}" of dataset "${id}".`,
      );
    input.sources.push(
      ...buildSources(urls.slice(0, room), [], input.sources.length, true),
    );
  }

  // Apify gives one CPU core per 4 GB of memory.
  const memoryMb = Number(process.env.ACTOR_MEMORY_MBYTES) || 1024;
  sharp.concurrency(Math.max(1, Math.floor(memoryMb / 4096)));
  sharp.cache(false);
  log.info(
    `${input.sources.length} image(s) to ${input.outputFormat}` +
      (input.targetBytes
        ? `, target ${input.targetBytes / 1024} KB`
        : `, quality ${input.quality}`) +
      (input.maxWidth || input.maxHeight
        ? `, max ${input.maxWidth ?? "any"}x${input.maxHeight ?? "any"} (${input.fit})`
        : "") +
      `, max ${input.maxInputPixels / 1e6} MP input.`,
  );

  const charging = Actor.getChargingManager();
  const ppe = charging.getPricingInfo().isPayPerEvent;
  const prices = charging.getPricingInfo().perEventPrices;
  // Events not priced in the Console are free.
  const priced = (event: EventName) => ppe && !!prices[event];
  const canCharge = (event: EventName) =>
    !priced(event) ||
    charging.calculateMaxEventChargeCountWithinLimit(event) >= 1;
  if (!canCharge(EVENTS.regular)) {
    log.warning("Max charge per run is too low for a single image.");
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
    decodeHeic,
    sample: () => sampleImage(SAMPLE.width, SAMPLE.height),
    canCharge,
    saveFile: async (key, data, contentType) => {
      await store.setValue(key, data, { contentType });
      return store.getPublicUrl(key);
    },
    deleteFile: (key) => store.setValue(key, null),
    // Charge first, then push, so an image is never delivered unpaid.
    // Failures are free.
    emit: async (item, event) => {
      if (!event || !priced(event)) {
        await Actor.pushData(item);
        return { pushed: true, more: true };
      }
      const stop = { pushed: false, more: false };
      // Never ask for more than the budget allows (the SDK would overcharge
      // to end the run). run.ts already skipped images over the budget.
      if (!canCharge(event)) return stop;
      const res = await Actor.charge({ eventName: event, count: 1 });
      if (res.chargedCount < 1) return stop;
      await Actor.pushData(item);
      return { pushed: true, more: canCharge(EVENTS.regular) };
    },
    log: (m) => log.info(m),
  });

  log.info(`Done: ${JSON.stringify(stats)}`);
  const saved =
    stats.bytesIn > 0
      ? `, ${Math.round((1 - stats.bytesOut / stats.bytesIn) * 100)}% smaller`
      : "";
  await Actor.setStatusMessage(
    `Converted ${stats.converted} image(s)` +
      (stats.convertedLarge ? ` (${stats.convertedLarge} over 12 MP)` : "") +
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
