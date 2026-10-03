import { Actor, log } from "apify";
import { gotFetch } from "./got-fetch.js";
import { EventbriteClient } from "./http.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { runEvents } from "./run.js";
import { Seen, stateKey } from "./state.js";

export const CHARGE_EVENT = "event";
/** Named (persistent) key-value store holding onlyNew state. */
export const STATE_STORE = "eventbrite-events-state";

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
    `${input.searches.length} search(es), ${input.eventUrls.length} event URL(s), up to ${input.maxEvents} events, details ${input.includeDetails ? "on" : "off"}` +
      (input.onlyNew ? ", only new" : "") +
      ".",
  );
  for (const s of input.searches) log.info(`Search: ${s.url}`);

  // onlyNew: state is keyed by the query, so each distinct input (e.g. each
  // scheduled task) tracks its own "already returned" events.
  let seen: Seen | undefined;
  let saveState: (() => Promise<void>) | undefined;
  if (input.onlyNew) {
    const store = await Actor.openKeyValueStore(STATE_STORE);
    const key = stateKey({
      searches: input.searches.map((s) => s.url).sort(),
      eventUrls: [...input.eventUrls].sort(),
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
      charging.calculateMaxEventChargeCountWithinLimit(CHARGE_EVENT);
    if (affordable <= 0) {
      log.warning("Max charge per run is too low for a single event.");
      await Actor.exit();
    }
    if (affordable < input.maxEvents) {
      // Don't fetch event pages that could never be charged.
      log.info(`Budget allows ${affordable} events.`);
      input.maxEvents = affordable;
    }
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
  // Same proxy session (IP) until a request fails, then a fresh one. If the
  // proxy keeps failing (timeouts, 5xx), fall back to direct requests; when
  // those get blocked, switch back to a new proxy IP.
  const prefix = `eb${Math.floor(Math.random() * 1e8)}`;
  let session = 0;
  if (proxy) log.info("Using Apify Proxy.");
  const client = new EventbriteClient({
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
    emit: async (item) => {
      const res = await Actor.pushData(item, CHARGE_EVENT);
      return !res.eventChargeLimitReached;
    },
  }).finally(() => saveState?.());

  log.info(
    `Done after ${client.requests} requests (${client.blocks} blocked, ${client.errors} errors): ${JSON.stringify(stats)}`,
  );
  const failed = stats.searches.filter((s) => s.status === "failed").length;
  await Actor.setStatusMessage(
    `${stats.emitted} events from ${stats.searches.length} search(es), ${stats.pages} page(s)` +
      (input.includeDetails ? `, ${stats.detailPages} event page(s)` : "") +
      (failed ? `, ${failed} failed` : "") +
      (stats.skippedSeen ? `, skipped ${stats.skippedSeen} seen before` : "") +
      (stats.stopReason === "budget" ? " (stopped at max charge)" : ""),
    { isStatusMessageTerminal: true },
  );
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
