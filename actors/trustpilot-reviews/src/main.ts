import { Actor, log } from "apify";
import { TrustpilotClient } from "./client.js";
import { makeHttp, USER_AGENT } from "./http.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { runScrape } from "./run.js";
import { Monitor, stateKey } from "./state.js";
import { browserTokenSolver } from "./waf.js";

export const CHARGE_EVENT = "review";
/** Named (persistent) key-value store holding onlyNew state. */
export const STATE_STORE = "trustpilot-reviews-state";

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

  log.info(
    `Up to ${input.maxReviewsPerCompany} reviews each for ${input.companies.join(", ")} ` +
      `(sort ${input.sort}, language ${input.language}` +
      (input.stars.length ? `, stars ${input.stars.join("/")}` : "") +
      (input.sinceDate ? `, since ${input.sinceDate}` : "") +
      (input.onlyNew ? ", only new" : "") +
      ").",
  );

  // onlyNew: state is keyed by the query, so each distinct input (e.g. each
  // scheduled task) tracks its own "already seen" reviews.
  let monitor: Monitor | undefined;
  let saveState: (() => Promise<void>) | undefined;
  if (input.onlyNew) {
    const store = await Actor.openKeyValueStore(STATE_STORE);
    const key = stateKey({
      companies: [...input.companies].sort(),
      stars: input.stars,
      language: input.language,
    });
    const m = new Monitor(await store.getValue(key));
    monitor = m;
    saveState = () => store.setValue(key, m.toJSON());
    log.info(`Only new reviews: state "${key}" in store "${STATE_STORE}".`);
  }

  const charging = Actor.getChargingManager();
  const ppe = charging.getPricingInfo().isPayPerEvent;
  if (ppe) {
    const budget =
      charging.calculateMaxEventChargeCountWithinLimit(CHARGE_EVENT);
    if (budget <= 0) {
      log.warning("Max charge per run is too low for a single review.");
      await Actor.exit();
    }
    if (budget < input.maxReviewsPerCompany * input.companies.length) {
      log.info(`Budget allows ${budget} reviews in total.`);
    }
  }

  // One sticky proxy session so the browser-issued token and the HTTP
  // requests share an exit IP.
  const proxyConfig = raw?.proxyConfiguration
    ? await Actor.createProxyConfiguration(raw.proxyConfiguration)
    : undefined;
  const session = `tp${Math.random().toString(36).slice(2, 10)}`;
  const proxyUrl = await proxyConfig?.newUrl(session);
  if (proxyUrl) log.info("Using proxy.");
  const http = makeHttp(proxyUrl);

  const client = new TrustpilotClient({
    fetch: http.fetch,
    userAgent: USER_AGENT,
    solveToken: browserTokenSolver({
      userAgent: USER_AGENT,
      rawFetch: http.raw,
      log: (m) => log.info(m),
    }),
    log: (m) => log.warning(m),
  });

  const stats = await runScrape(input, {
    client,
    log: (m) => log.warning(m),
    monitor,
    afterCompany: saveState,
    // Charge first, then save, so a review is never delivered unpaid and
    // the run stops exactly at ACTOR_MAX_TOTAL_CHARGE_USD.
    emit: async (item) => {
      if (!ppe) {
        await Actor.pushData(item);
        return true;
      }
      const res = await Actor.charge({ eventName: CHARGE_EVENT });
      if (res.chargedCount < 1) return false;
      await Actor.pushData(item);
      return !res.eventChargeLimitReached;
    },
  });

  log.info(
    `Done: ${JSON.stringify({ ...stats, requests: client.requests, verifications: client.solves })}`,
  );
  const per = Object.entries(stats.companies)
    .map(([c, s]) => `${c} ${s.status === "ok" ? s.emitted : s.status}`)
    .join(", ");
  await Actor.setStatusMessage(
    `Scraped ${stats.emitted} reviews (${per})` +
      (stats.stopReason === "budget" ? " (stopped at max charge)" : ""),
    { isStatusMessageTerminal: true },
  );
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
