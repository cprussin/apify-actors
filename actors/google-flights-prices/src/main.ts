import { Actor, log } from "apify";
import { FlightsClient, type FetchLike } from "./http.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { proxiedFetch } from "./proxy-fetch.js";
import { runFlights } from "./run.js";
import { Seen, stateKey } from "./state.js";

export const CHARGE_EVENT = "itinerary";
/** Named (persistent) key-value store holding onlyNew state. */
export const STATE_STORE = "google-flights-prices-state";

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
  const first = input.searches[0]!;
  log.info(
    `${input.searches.length} search(es), up to ${input.maxItineraries} itineraries each; ${first.adults} adult(s), ${first.cabin}, ${first.currency}` +
      (input.onlyNew ? "; only new or changed prices" : "") +
      ".",
  );

  // onlyNew: state is keyed by routes and search settings (not dates, which
  // move with relative dates); itinerary keys include the dates.
  let seen: Seen | undefined;
  let saveState: (() => Promise<void>) | undefined;
  if (input.onlyNew) {
    const store = await Actor.openKeyValueStore(STATE_STORE);
    const key = stateKey({
      routes: [
        ...new Set(input.searches.map((s) => `${s.origin}-${s.destination}`)),
      ].sort(),
      adults: first.adults,
      cabin: first.cabin,
      maxStops: first.maxStops,
      currency: first.currency,
      country: first.gl,
    });
    const s = new Seen(await store.getValue(key));
    seen = s;
    saveState = () => store.setValue(key, s.toJSON());
    Actor.on("persistState", saveState);
    log.info(
      `Only new or changed prices: state "${key}" in store "${STATE_STORE}" (${s.size} known).`,
    );
  }

  const charging = Actor.getChargingManager();
  if (charging.getPricingInfo().isPayPerEvent) {
    const affordable =
      charging.calculateMaxEventChargeCountWithinLimit(CHARGE_EVENT);
    if (affordable <= 0) {
      log.warning("Max charge per run is too low for a single itinerary.");
      await Actor.exit();
    }
    const wanted = input.searches.length * input.maxItineraries;
    if (affordable < wanted)
      log.info(`Budget allows ${affordable} itineraries.`);
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
  const prefix = `gf${Math.floor(Math.random() * 1e8)}`;
  let session = 0;
  if (proxy) log.info("Using Apify Proxy.");
  const client = new FlightsClient({
    fetch: proxy
      ? proxiedFetch(() => proxy.newUrl(`${prefix}_${session}`))
      : undefined,
    fallbackFetch: proxy
      ? (globalThis.fetch as unknown as FetchLike)
      : undefined,
    rotate: () => {
      session += 1;
    },
    ...(proxy ? { rotatedDelayMs: 500, maxRetries: 8 } : {}),
    acceptLanguage: `${first.hl},en;q=0.8`,
    timeoutMs: 20_000,
    maxRequestMs: 60_000,
    maxFailingMs: 120_000,
    log: (m) => log.warning(m),
  });

  const stats = await runFlights(input, {
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
  await Actor.setStatusMessage(
    `${stats.emitted} itineraries from ${stats.searches} searches` +
      (stats.empty.length ? `, ${stats.empty.length} without flights` : "") +
      (stats.failed.length ? `, ${stats.failed.length} failed` : "") +
      (stats.skippedSeen ? `, ${stats.skippedSeen} unchanged skipped` : "") +
      (stats.stopReason === "budget" ? " (stopped at max charge)" : ""),
    { isStatusMessageTerminal: true },
  );
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
