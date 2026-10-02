import { Actor, log } from "apify";
import { ApiSource } from "./api.js";
import { FeedSource } from "./feed.js";
import { HttpClient } from "./http.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { proxiedFetch } from "./proxy-fetch.js";
import { refKey } from "./launch.js";
import { runLaunches } from "./run.js";
import { Seen, stateKey } from "./state.js";
import { WebsiteResolver } from "./website.js";

export const LAUNCH_EVENT = "launch";
export const COMMENT_EVENT = "comment";
/** Named (persistent) key-value store holding onlyNew state. */
export const STATE_STORE = "product-hunt-launches-state";

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
    `Mode ${input.mode}` +
      (input.mode === "leaderboard"
        ? ` (${input.period}, ${input.startDate} to ${input.endDate})`
        : "") +
      (input.topics.length ? `, topics ${input.topics.join(", ")}` : "") +
      (input.keywords.length ? `, keywords ${input.keywords.join("|")}` : "") +
      `, up to ${input.maxItems} launches, source: ${input.apiToken ? "Product Hunt API (token)" : "public feed (no token)"}` +
      (input.onlyNew ? ", only new" : "") +
      ".",
  );

  // onlyNew: state is keyed by the query (not dates, which move with
  // relative dates), so each scheduled task tracks its own launches.
  let seen: Seen | undefined;
  let saveState: (() => Promise<void>) | undefined;
  if (input.onlyNew) {
    const store = await Actor.openKeyValueStore(STATE_STORE);
    const key = stateKey({
      mode: input.mode,
      period: input.mode === "leaderboard" ? input.period : undefined,
      topics: [...input.topics].sort(),
      posts: input.posts.map(refKey).sort(),
      keywords: [...input.keywords].sort(),
      featuredOnly: input.featuredOnly,
    });
    const s = new Seen(await store.getValue(key));
    seen = s;
    saveState = () => store.setValue(key, s.toJSON());
    Actor.on("persistState", saveState);
    log.info(
      `Only new launches: state "${key}" in store "${STATE_STORE}" (${s.size} known).`,
    );
  }

  const charging = Actor.getChargingManager();
  const ppe = charging.getPricingInfo().isPayPerEvent;
  if (ppe) {
    const budget =
      charging.calculateMaxEventChargeCountWithinLimit(LAUNCH_EVENT);
    if (budget <= 0) {
      log.warning("Max charge per run is too low for a single launch.");
      await Actor.exit();
    }
    if (budget < input.maxItems) log.info(`Budget allows ${budget} launches.`);
  }

  const proxy = raw?.proxyConfiguration
    ? await Actor.createProxyConfiguration(raw.proxyConfiguration)
    : undefined;
  if (proxy) log.info("Using proxy.");
  const http = new HttpClient({
    fetch: proxy ? proxiedFetch(() => proxy.newUrl()) : undefined,
    log: (m) => log.warning(m),
  });
  // The API is authenticated and rate-limited per token; no proxy needed.
  const apiHttp = new HttpClient({ log: (m) => log.warning(m) });

  const warn = (m: string) => log.warning(m);
  const feed = new FeedSource(http, warn);
  const api = input.apiToken
    ? new ApiSource(apiHttp, {
        token: input.apiToken,
        includeMakers: input.includeMakers,
        log: warn,
      })
    : undefined;
  const websites = new WebsiteResolver(http, (m) => log.info(m));

  let comments = 0;
  const stats = await runLaunches(input, {
    feed,
    api,
    websites,
    log: warn,
    seen,
    // Charge first, then save, so nothing is delivered unpaid and the run
    // stops exactly at ACTOR_MAX_TOTAL_CHARGE_USD. Items are only charged
    // once fully built, so failed launches are never billed.
    emit: async (item) => {
      if (!ppe) {
        await Actor.pushData(item);
        comments += item.comments?.length ?? 0;
        return true;
      }
      const res = await Actor.charge({ eventName: LAUNCH_EVENT });
      if (res.chargedCount < 1) return false;
      let limitReached = res.eventChargeLimitReached;
      if (item.comments?.length) {
        const c = await Actor.charge({
          eventName: COMMENT_EVENT,
          count: item.comments.length,
        });
        item.comments = item.comments.slice(0, c.chargedCount);
        limitReached ||= c.eventChargeLimitReached;
      }
      comments += item.comments?.length ?? 0;
      await Actor.pushData(item);
      return !limitReached;
    },
  }).finally(() => saveState?.());

  log.info(
    `Done: ${JSON.stringify({ ...stats, comments, requests: http.requests + apiHttp.requests, websitesResolved: websites.resolved })}`,
  );
  const per = Object.entries(stats.groups)
    .map(([k, s]) => `${k} ${s.status === "ok" ? s.emitted : s.status}`)
    .join(", ");
  await Actor.setStatusMessage(
    `Scraped ${stats.emitted} launches` +
      (comments ? ` and ${comments} comments` : "") +
      ` (${per})` +
      (stats.skippedSeen ? `, skipped ${stats.skippedSeen} seen before` : "") +
      (stats.stopReason === "budget" ? " (stopped at max charge)" : ""),
    { isStatusMessageTerminal: true },
  );
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
