import { Actor, log } from "apify";
import { gotFetch } from "./got-fetch.js";
import { WellfoundClient } from "./http.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { runJobs } from "./run.js";
import { Seen, stateKey } from "./state.js";
import { listingUrl } from "./wellfound.js";

export const CHARGE_EVENT = "job";
/** Named (persistent) key-value store holding onlyNew state. */
export const STATE_STORE = "wellfound-jobs-state";

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
    `${input.searches.length} search(es), up to ${input.maxJobs} jobs in total, ${input.maxPages} page(s) per search` +
      (input.onlyNew ? ", only new" : "") +
      ".",
  );
  for (const s of input.searches)
    log.info(`Search: ${listingUrl(s, s.startPage)}`);

  // onlyNew: state is keyed by the searches, so each distinct input (e.g.
  // each scheduled task) tracks its own "already returned" jobs.
  let seen: Seen | undefined;
  let saveState: (() => Promise<void>) | undefined;
  if (input.onlyNew) {
    const store = await Actor.openKeyValueStore(STATE_STORE);
    const key = stateKey({
      searches: input.searches
        .map((s) => `${s.role ?? ""}@${s.location ?? ""}`)
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
    if (affordable < input.maxJobs)
      log.info(`Budget allows ${affordable} jobs.`);
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
  const prefix = `wf${Math.floor(Math.random() * 1e8)}`;
  let session = 0;
  if (proxy) log.info("Using Apify Proxy.");
  const client = new WellfoundClient({
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

  const stats = await runJobs(input, {
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
