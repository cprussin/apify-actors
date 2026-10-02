import { Actor, log } from "apify";
import { AppleSource } from "./apple.js";
import { GoogleSource } from "./google.js";
import { HttpClient } from "./http.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { proxiedFetch } from "./proxy-fetch.js";
import { runReviews } from "./run.js";
import { Monitor, stateKey } from "./state.js";

export const CHARGE_EVENT = "review";
/** Named (persistent) key-value store holding onlyNew state. */
export const STATE_STORE = "app-store-reviews-state";

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
    `${input.apps.length} app(s), country ${input.country}, language ${input.language}, sort ${input.sort}, up to ${input.maxReviewsPerApp} reviews each` +
      (input.since ? `, since ${input.since}` : "") +
      (input.minRating > 1 || input.maxRating < 5
        ? `, rating ${input.minRating}-${input.maxRating}`
        : "") +
      (input.onlyNew ? ", only new" : "") +
      ".",
  );

  // onlyNew: state is keyed by the query, so each distinct input (e.g. each
  // scheduled task) tracks its own "already seen" reviews.
  let monitor: Monitor | undefined;
  let saveState: (() => Promise<void>) | undefined;
  if (input.onlyNew) {
    const store = await Actor.openKeyValueStore(STATE_STORE);
    const key = stateKey({
      apps: input.apps.map((a) => `${a.store}:${a.id}`).sort(),
      country: input.country,
      language: input.language,
      minRating: input.minRating,
      maxRating: input.maxRating,
    });
    const m = new Monitor(await store.getValue(key));
    monitor = m;
    saveState = () => store.setValue(key, m.toJSON());
    log.info(`Only new reviews: state "${key}" in store "${STATE_STORE}".`);
  }

  const charging = Actor.getChargingManager();
  if (charging.getPricingInfo().isPayPerEvent) {
    const affordable =
      charging.calculateMaxEventChargeCountWithinLimit(CHARGE_EVENT);
    if (affordable <= 0) {
      log.warning("Max charge per run is too low for a single review.");
      await Actor.exit();
    }
    if (affordable < input.apps.length * input.maxReviewsPerApp) {
      log.info(`Budget allows ${affordable} reviews in total.`);
    }
  }

  const proxy = raw?.proxyConfiguration
    ? await Actor.createProxyConfiguration(raw.proxyConfiguration)
    : undefined;
  if (proxy) log.info("Using proxy.");
  const http = new HttpClient({
    fetch: proxy ? proxiedFetch(() => proxy.newUrl()) : undefined,
    log: (m) => log.warning(m),
  });

  const stats = await runReviews(input, {
    sources: { apple: new AppleSource(http), google: new GoogleSource(http) },
    log: (m) => log.warning(m),
    monitor,
    afterApp: saveState,
    emit: async (item) => {
      const res = await Actor.pushData(item, CHARGE_EVENT);
      return !res.eventChargeLimitReached;
    },
  });

  log.info(`Done after ${http.requests} requests: ${JSON.stringify(stats)}`);
  const perApp = Object.entries(stats.apps)
    .map(
      ([k, s]) =>
        `${s.appName ?? k}: ${s.status === "failed" || s.status === "notFound" ? s.status : s.emitted}`,
    )
    .join(", ");
  await Actor.setStatusMessage(
    `Scraped ${stats.emitted} reviews (${perApp})` +
      (stats.stopReason === "budget" ? " (stopped at max charge)" : ""),
    { isStatusMessageTerminal: true },
  );
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
