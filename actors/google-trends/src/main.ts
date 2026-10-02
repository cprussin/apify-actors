import { Actor, log } from "apify";
import { GoogleTrends } from "./google-trends.js";
import { TrendsClient, type FetchLike } from "./http.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { proxiedFetch } from "./proxy-fetch.js";
import { runTrends } from "./run.js";
import { Seen, stateKey } from "./state.js";

export const CHARGE_EVENT = "trend-result";
/** Named (persistent) key-value store holding onlyNew state. */
export const STATE_STORE = "google-trends-state";

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
    input.mode === "trendingNow"
      ? `Trending now in ${input.geo}, past ${input.hours} hours, up to ${input.maxResults} searches${input.onlyNew ? ", only new" : ""}.`
      : `${input.terms.length} term(s), geo ${input.query.geo || "worldwide"}, timeframe ${input.query.time}, datasets ${input.datasets.join(", ")}.`,
  );

  // onlyNew (trending now only): state is keyed by country, so each
  // scheduled task tracks its own "already returned" searches.
  let seen: Seen | undefined;
  let saveState: (() => Promise<void>) | undefined;
  if (input.mode === "trendingNow" && input.onlyNew) {
    const store = await Actor.openKeyValueStore(STATE_STORE);
    const key = stateKey({ mode: input.mode, geo: input.geo });
    const s = new Seen(await store.getValue(key));
    seen = s;
    saveState = () => store.setValue(key, s.toJSON());
    Actor.on("persistState", saveState);
    log.info(
      `Only new trending searches: state "${key}" in store "${STATE_STORE}" (${s.size} known).`,
    );
  } else if (raw?.onlyNew) {
    log.info("onlyNew applies to Trending now only; ignored in Explore mode.");
  }

  const charging = Actor.getChargingManager();
  if (charging.getPricingInfo().isPayPerEvent) {
    const affordable =
      charging.calculateMaxEventChargeCountWithinLimit(CHARGE_EVENT);
    if (affordable <= 0) {
      log.warning("Max charge per run is too low for a single result.");
      await Actor.exit();
    }
    const wanted =
      input.mode === "trendingNow"
        ? input.maxResults
        : input.terms.length * input.datasets.length;
    if (affordable < wanted) log.info(`Budget allows ${affordable} results.`);
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
  const prefix = `gt${Math.floor(Math.random() * 1e8)}`;
  let session = 0;
  if (proxy) log.info("Using Apify Proxy.");
  const client = new TrendsClient({
    fetch: proxy
      ? proxiedFetch(() => proxy.newUrl(`${prefix}_${session}`))
      : undefined,
    fallbackFetch: proxy
      ? (globalThis.fetch as unknown as FetchLike)
      : undefined,
    rotate: () => {
      session += 1;
    },
    // With a proxy every failure switches IP, so retry quickly and more often.
    ...(proxy ? { rotatedDelayMs: 500, maxRetries: 8 } : {}),
    timeoutMs: 15_000,
    maxRequestMs: 45_000,
    maxFailingMs: 90_000,
    log: (m) => log.warning(m),
  });

  const stats = await runTrends(input, {
    trends: new GoogleTrends(client),
    log: (m) => log.warning(m),
    seen,
    emit: async (item, charge) => {
      if (!charge) {
        await Actor.pushData(item);
        return true;
      }
      const res = await Actor.pushData(item, CHARGE_EVENT);
      return !res.eventChargeLimitReached;
    },
  }).finally(() => saveState?.());

  log.info(
    `Done after ${client.requests} requests (${client.blocks} blocked, ${client.errors} errors): ${JSON.stringify(stats)}`,
  );
  await Actor.setStatusMessage(
    `${stats.charged} results` +
      (stats.empty ? `, ${stats.empty} without data (free)` : "") +
      (stats.failed.length ? `, ${stats.failed.length} failed` : "") +
      (stats.skippedSeen ? `, skipped ${stats.skippedSeen} seen before` : "") +
      (stats.stopReason === "budget" ? " (stopped at max charge)" : ""),
    { isStatusMessageTerminal: true },
  );
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
