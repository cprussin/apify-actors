import { Actor, log, type ProxyConfiguration } from "apify";
import { MIN_INTERVAL_MS, searchUrl, SITES, type Site } from "./gladiator.js";
import { gotFetch } from "./got-fetch.js";
import { GladiatorClient } from "./http.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { runJobs } from "./run.js";
import { Seen, stateKey } from "./state.js";

export const CHARGE_EVENT = "job";
/** Named (persistent) key-value store holding onlyNew state. */
export const STATE_STORE = "hirist-iimjobs-jobs-state";

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
    `${input.searches.length} search(es) on ${input.sites.join(" + ")}, up to ${input.maxItems} jobs in total` +
      (input.includeDescription ? ", with descriptions" : "") +
      (input.onlyNew ? ", only new" : "") +
      ".",
  );
  for (const s of input.searches) log.info(`Search: ${searchUrl(s, 0)}`);
  if (input.sites.includes("iimjobs"))
    log.info(
      "iimjobs.com asks for 10 s between requests (robots.txt Crawl-delay); iimjobs searches run at that pace.",
    );

  // onlyNew: state is keyed by the searches, so each distinct input (e.g.
  // each scheduled task) tracks its own "already returned" jobs.
  let seen: Seen | undefined;
  let saveState: (() => Promise<void>) | undefined;
  if (input.onlyNew) {
    const store = await Actor.openKeyValueStore(STATE_STORE);
    const key = stateKey({
      searches: input.searches
        .map(
          (s) =>
            `${s.site}:${s.query.toLowerCase()}@${s.locationIds.join(",")}#${s.minExperience ?? ""}-${s.maxExperience ?? ""}`,
        )
        .sort(),
    });
    const s = new Seen(await store.getValue(key));
    seen = s;
    saveState = () => store.setValue(key, s.toJSON());
    Actor.on("persistState", saveState);
    log.info(
      `Only new jobs: state "${key}" in store "${STATE_STORE}" (${s.size} known).`,
    );
  }

  const charging = Actor.getChargingManager();
  if (charging.getPricingInfo().isPayPerEvent) {
    const affordable =
      charging.calculateMaxEventChargeCountWithinLimit(CHARGE_EVENT);
    if (affordable <= 0) {
      log.warning("Max charge per run is too low for a single job.");
      await Actor.exit();
    }
    if (affordable < input.maxItems)
      log.info(`Budget allows ${affordable} jobs.`);
  }

  let proxy: ProxyConfiguration | undefined;
  if (raw?.proxyConfiguration) {
    try {
      proxy = await Actor.createProxyConfiguration(raw.proxyConfiguration);
    } catch (e) {
      // e.g. local runs without an Apify token.
      log.warning(`Proxy unavailable, continuing without: ${String(e)}`);
    }
  }
  if (proxy) log.info("Using Apify Proxy.");

  // One client per site, one request at a time: ~1/s on Hirist, one per
  // 10 s on iimjobs. Same proxy session (IP) until a request fails, then a
  // fresh one; if the proxy keeps failing, fall back to direct requests.
  const clients = Object.fromEntries(
    SITES.map((site) => {
      const prefix = `hi${site[0]}${Math.floor(Math.random() * 1e8)}`;
      let session = 0;
      const client = new GladiatorClient({
        fetch: gotFetch(
          proxy ? () => proxy.newUrl(`${prefix}_${session}`) : undefined,
        ),
        fallbackFetch: proxy ? gotFetch() : undefined,
        rotate: () => {
          session += 1;
        },
        // Retries still wait for the site's minimum interval.
        ...(proxy ? { rotatedDelayMs: 0, maxRetries: 6 } : {}),
        minIntervalMs: MIN_INTERVAL_MS[site],
        timeoutMs: 30_000,
        maxRequestMs: 180_000,
        maxFailingMs: 300_000,
        log: (m) => log.warning(`${site}: ${m}`),
      });
      return [site, client];
    }),
  ) as Record<Site, GladiatorClient>;

  const stats = await runJobs(input, {
    get: (url, site) => clients[site].get(url),
    log: (m) => log.warning(m),
    seen,
    emit: async (item) => {
      const res = await Actor.pushData(item, CHARGE_EVENT);
      return !res.eventChargeLimitReached;
    },
  }).finally(() => saveState?.());

  const requests = SITES.map(
    (s) =>
      `${s} ${clients[s].requests} (${clients[s].blocks} blocked, ${clients[s].errors} errors)`,
  ).join(", ");
  log.info(`Done. Requests: ${requests}. ${JSON.stringify(stats)}`);
  const failed = stats.searches.filter((s) => s.status === "failed").length;
  await Actor.setStatusMessage(
    `${stats.emitted} jobs from ${stats.searches.length} search(es), ${stats.pages} page(s)` +
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
