import { Actor, log } from "apify";
import { AlgoliaSearch } from "./algolia.js";
import { gotFetch } from "./got-fetch.js";
import { YcClient } from "./http.js";
import {
  InputError,
  normalizeInput,
  stateParams,
  type RawInput,
} from "./input.js";
import { FilterError, run } from "./run.js";
import { Seen, stateKey } from "./state.js";
import { DIRECTORY_URL, extractAlgoliaOpts } from "./yc.js";

export const COMPANY_EVENT = "company";
export const JOB_EVENT = "job";
/** Named (persistent) key-value store holding onlyNew state. */
export const STATE_STORE = "ycombinator-companies-state";

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
  const f = input.filters;
  const event = input.mode === "companies" ? COMPANY_EVENT : JOB_EVENT;
  log.info(
    `Mode ${input.mode}, up to ${input.maxItems} ${input.mode}` +
      (input.onlyNew ? ", only new" : "") +
      ".",
  );
  if (input.mode === "companies" || input.jobsFromFilteredCompanies)
    log.info(`Company filters: ${JSON.stringify(f)}`);
  if (input.mode === "jobs")
    log.info(
      `Job roles: ${input.jobRoles.join(", ") || "-"}; location: ${input.jobLocation ?? "all"}; companies: ${input.companySlugs.join(", ") || "-"}`,
    );

  // onlyNew: state is keyed by the query, so each distinct input (e.g.
  // each scheduled task) tracks its own "already returned" items.
  let seen: Seen | undefined;
  let saveState: (() => Promise<void>) | undefined;
  if (input.onlyNew) {
    const store = await Actor.openKeyValueStore(STATE_STORE);
    const key = stateKey(stateParams(input));
    const s = new Seen(await store.getValue(key));
    seen = s;
    saveState = () => store.setValue(key, s.toJSON());
    Actor.on("persistState", saveState);
    log.info(
      `Only new ${input.mode}: state "${key}" in store "${STATE_STORE}" (${s.size} known).`,
    );
  }

  const charging = Actor.getChargingManager();
  if (charging.getPricingInfo().isPayPerEvent) {
    const affordable = charging.calculateMaxEventChargeCountWithinLimit(event);
    if (affordable <= 0) {
      log.warning(`Max charge per run is too low for a single ${event}.`);
      await Actor.exit();
    }
    if (affordable < input.maxItems)
      log.info(`Budget allows ${affordable} ${input.mode}.`);
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
  // YC pages: same proxy session until a request fails, then a fresh one,
  // with a direct fallback. Algolia is a public API: always direct.
  const prefix = `yc${Math.floor(Math.random() * 1e8)}`;
  let session = 0;
  if (proxy) log.info("Using Apify Proxy for ycombinator.com pages.");
  const client = new YcClient({
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
  const api = new YcClient({
    maxRetries: 3,
    timeoutMs: 30_000,
    maxRequestMs: 90_000,
    log: (m) => log.warning(m),
  });

  let algolia: AlgoliaSearch | undefined;
  const stats = await run(input, {
    get: (url) => client.get(url),
    algolia: async () => {
      if (algolia) return algolia;
      // The search-only key is embedded in the public directory page.
      const page = await client.get(DIRECTORY_URL);
      const opts = extractAlgoliaOpts(page.html);
      if (!opts)
        throw new Error(
          `Could not find the Algolia search key on ${DIRECTORY_URL}.`,
        );
      algolia = new AlgoliaSearch(opts, (url, body, headers) =>
        api.post(url, body, headers),
      );
      return algolia;
    },
    log: (m) => log.warning(m),
    seen,
    emit: async (item) => {
      const res = await Actor.pushData(item, event);
      return !res.eventChargeLimitReached;
    },
  }).finally(() => saveState?.());

  log.info(
    `Done after ${client.requests} page and ${api.requests} API requests (${client.blocks} blocked, ${client.errors + api.errors} errors): ${JSON.stringify(stats)}`,
  );
  const failed = stats.sources.filter((s) => s.status === "failed").length;
  await Actor.setStatusMessage(
    `${stats.emitted} ${input.mode}` +
      (stats.totalMatches !== null && input.mode === "companies"
        ? ` of ${stats.totalMatches} matching`
        : "") +
      (input.mode === "jobs" ? ` from ${stats.sources.length} page(s)` : "") +
      (failed ? `, ${failed} failed` : "") +
      (stats.skippedSeen ? `, skipped ${stats.skippedSeen} seen before` : "") +
      (stats.stopReason === "budget" ? " (stopped at max charge)" : ""),
    { isStatusMessageTerminal: true },
  );
  await Actor.exit();
} catch (e) {
  if (e instanceof FilterError) {
    await Actor.fail(`Invalid filter: ${e.message}`);
  }
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
