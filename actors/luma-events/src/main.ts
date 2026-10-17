import { Actor, log } from "apify";
import { gotFetch } from "./got-fetch.js";
import { LumaClient } from "./http.js";
import {
  InputError,
  normalizeInput,
  targetKey,
  type RawInput,
} from "./input.js";
import { runEvents } from "./run.js";
import { Seen, stateKey } from "./state.js";

/** Named (persistent) key-value store holding onlyNew state. */
export const STATE_STORE = "luma-events-state";

await Actor.init();

try {
  let input;
  const raw = await Actor.getInput<RawInput>();
  try {
    input = normalizeInput(raw);
  } catch (e) {
    if (e instanceof InputError) {
      await Actor.fail(`Invalid input: ${e.message}`);
    }
    throw e;
  }
  log.info(
    `${input.targets.length} target(s): ${input.targets.map(targetKey).join(", ")}; up to ${input.maxEvents} events, details ${input.includeDetails ? "on" : "off"}` +
      (input.category ? `, category ${input.category}` : "") +
      (input.keyword ? `, keyword "${input.keyword}"` : "") +
      (input.onlyNew ? ", only new" : "") +
      ".",
  );

  // onlyNew: state is keyed by the query, so each distinct input (e.g. each
  // scheduled task) tracks its own "already returned" events.
  let seen: Seen | undefined;
  let saveState: (() => Promise<void>) | undefined;
  if (input.onlyNew) {
    const store = await Actor.openKeyValueStore(STATE_STORE);
    const key = stateKey({
      targets: input.targets.map(targetKey).sort(),
      category: input.category,
      keyword: input.keyword,
      calendarPeriod: input.calendarPeriod,
    });
    const s = new Seen(await store.getValue(key));
    seen = s;
    saveState = () => store.setValue(key, s.toJSON());
    Actor.on("persistState", saveState);
    log.info(
      `Only new events: state "${key}" in store "${STATE_STORE}" (${s.size} known).`,
    );
  }

  const charging = Actor.getChargingManager();
  if (charging.getPricingInfo().isPayPerEvent) {
    const affordable =
      charging.calculateMaxEventChargeCountWithinLimit("event");
    if (affordable <= 0) {
      log.warning("Max charge per run is too low for a single event.");
      await Actor.exit();
    }
    if (affordable < input.maxEvents)
      log.info(`Budget allows at most ${affordable} events.`);
  }

  let proxy;
  if (raw?.proxyConfiguration) {
    try {
      proxy = await Actor.createProxyConfiguration(raw.proxyConfiguration);
    } catch (e) {
      // e.g. local runs without an Apify token.
      log.warning(`Proxy unavailable, continuing without: ${String(e)}`);
    }
  }
  // Direct by default. With a proxy: same session (IP) until a request
  // fails, then a fresh one, with direct requests as the fallback.
  const prefix = `lu${Math.floor(Math.random() * 1e8)}`;
  let session = 0;
  if (proxy) log.info("Using Apify Proxy.");
  const client = new LumaClient({
    fetch: gotFetch(
      proxy ? () => proxy.newUrl(`${prefix}_${session}`) : undefined,
    ),
    fallbackFetch: proxy ? gotFetch() : undefined,
    rotate: () => {
      session += 1;
    },
    ...(proxy ? { rotatedDelayMs: 1000, maxRetries: 6 } : {}),
    timeoutMs: 30_000,
    maxRequestMs: 90_000,
    maxFailingMs: 180_000,
    log: (m) => log.warning(m),
  });

  const stats = await runEvents(input, {
    get: (url) => client.get(url),
    log: (m) => log.warning(m),
    seen,
    emit: async (item, events) => {
      const res = await Actor.pushData(item, "event");
      if (res.eventChargeLimitReached) return false;
      if (events.includes("event-detail")) {
        const d = await Actor.charge({ eventName: "event-detail" });
        if (d.eventChargeLimitReached) return false;
      }
      return true;
    },
  }).finally(() => saveState?.());

  log.info(
    `Done after ${client.requests} requests (${client.blocks} blocked, ${client.errors} errors): ${JSON.stringify(stats)}`,
  );
  const failed = stats.targets.filter((s) => s.status === "failed").length;
  const notFound = stats.targets.filter((s) => s.status === "notFound").length;
  await Actor.setStatusMessage(
    `${stats.emitted} events from ${stats.targets.length} target(s), ${stats.pages} page(s)` +
      (stats.detailPages ? `, ${stats.detailPages} event detail(s)` : "") +
      (failed ? `, ${failed} failed` : "") +
      (notFound ? `, ${notFound} not found` : "") +
      (stats.skippedSeen ? `, skipped ${stats.skippedSeen} seen before` : "") +
      (stats.stopReason === "budget" ? " (stopped at max charge)" : ""),
    { isStatusMessageTerminal: true },
  );
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
