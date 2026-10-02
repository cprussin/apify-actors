import { Actor, log } from "apify";
import { HttpClient } from "./http.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { proxiedFetch } from "./proxy-fetch.js";
import { eventFor, runScrape } from "./run.js";
import { Seen, stateKey } from "./state.js";
import { SubstackClient } from "./substack.js";
import { targetKey } from "./target.js";

/** Named (persistent) key-value store holding onlyNew state. */
export const STATE_STORE = "substack-scraper-state";

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
  const event = eventFor(input);

  log.info(
    `${input.targets.length} publication(s)/post(s), up to ${input.maxPostsPerPublication} posts each` +
      (input.includeContent ? ", with content" : ", metadata only") +
      (input.since ? `, since ${input.since}` : "") +
      (input.search ? `, search "${input.search}"` : "") +
      (input.onlyNew ? ", only new" : "") +
      ".",
  );

  // onlyNew: state is keyed by the query, so each distinct input (e.g. each
  // scheduled task) tracks its own "already returned" posts.
  let seen: Seen | undefined;
  let saveState: (() => Promise<void>) | undefined;
  if (input.onlyNew) {
    const store = await Actor.openKeyValueStore(STATE_STORE);
    const key = stateKey({
      targets: input.targets.map(targetKey).sort(),
      search: input.search,
    });
    const s = new Seen(await store.getValue(key));
    seen = s;
    saveState = () => store.setValue(key, s.toJSON());
    Actor.on("persistState", saveState);
    log.info(
      `Only new posts: state "${key}" in store "${STATE_STORE}" (${s.size} known).`,
    );
  }

  const charging = Actor.getChargingManager();
  // Posts we may still charge for (ACTOR_MAX_TOTAL_CHARGE_USD).
  let remaining = Infinity;
  if (charging.getPricingInfo().isPayPerEvent) {
    const affordable = charging.calculateMaxEventChargeCountWithinLimit(event);
    remaining = affordable;
    if (affordable <= 0) {
      log.warning("Max charge per run is too low for a single post.");
      await Actor.exit();
    }
    if (affordable < input.targets.length * input.maxPostsPerPublication) {
      log.info(`Budget allows ${affordable} posts in total.`);
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

  const stats = await runScrape(input, {
    client: new SubstackClient(http),
    log: (m) => log.warning(m),
    seen,
    emit: async (item) => {
      const res = await Actor.pushData(item, event);
      remaining -= 1;
      return !res.eventChargeLimitReached && remaining > 0;
    },
  }).finally(() => saveState?.());

  log.info(`Done after ${http.requests} requests: ${JSON.stringify(stats)}`);
  const perTarget = Object.entries(stats.targets)
    .map(
      ([k, s]) =>
        `${s.publicationName ?? k}: ${s.status === "failed" || s.status === "notFound" ? s.status : s.emitted}`,
    )
    .join(", ");
  await Actor.setStatusMessage(
    `Scraped ${stats.emitted} posts (${perTarget})` +
      (stats.stopReason === "budget" ? " (stopped at max charge)" : ""),
    { isStatusMessageTerminal: true },
  );
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
