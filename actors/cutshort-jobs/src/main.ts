import { Actor, log } from "apify";
import { listingPageUrl, SITEMAP_URL } from "./cutshort.js";
import { gotFetch } from "./got-fetch.js";
import { CutshortClient } from "./http.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { Monitor, stateKey } from "./monitor.js";
import { runJobs } from "./run.js";

/** Named (persistent) key-value store holding monitorMode state. */
export const STATE_STORE = "cutshort-jobs-state";

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
    (input.mode === "sitemap"
      ? `All jobs from ${SITEMAP_URL}`
      : `${input.searches.length} search(es)`) +
      `, up to ${input.maxItems} jobs` +
      (input.includeDetails || input.mode === "sitemap"
        ? ", with details"
        : "") +
      (input.monitorMode ? ", monitor mode" : "") +
      ".",
  );
  for (const s of input.searches)
    log.info(`Search: ${s.candidates.map(listingPageUrl).join(" or ")}`);

  // monitorMode: state is keyed by the searches, so each distinct input
  // (e.g. each scheduled task) tracks its own jobs.
  let monitor: Monitor | undefined;
  let saveState: (() => Promise<void>) | undefined;
  if (input.monitorMode) {
    const store = await Actor.openKeyValueStore(STATE_STORE);
    const key = stateKey({
      mode: input.mode,
      searches: input.searches.map((s) => s.candidates[0]).sort(),
    });
    const m = new Monitor(await store.getValue(key));
    monitor = m;
    saveState = () => store.setValue(key, m.toJSON());
    Actor.on("persistState", saveState);
    log.info(
      `Monitor mode: state "${key}" in store "${STATE_STORE}" (${m.size} known jobs).`,
    );
  }

  const charging = Actor.getChargingManager();
  if (charging.getPricingInfo().isPayPerEvent) {
    const affordable = charging.calculateMaxEventChargeCountWithinLimit("job");
    if (affordable <= 0) {
      log.warning("Max charge per run is too low for a single job.");
      await Actor.exit();
    }
    if (affordable < input.maxItems)
      log.info(`Budget allows at most ${affordable} jobs.`);
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
  const prefix = `cs${Math.floor(Math.random() * 1e8)}`;
  let session = 0;
  if (proxy) log.info("Using Apify Proxy.");
  // One request at a time, at most ~1 per second: polite to cutshort.io.
  const client = new CutshortClient({
    fetch: gotFetch(
      proxy ? () => proxy.newUrl(`${prefix}_${session}`) : undefined,
    ),
    fallbackFetch: proxy ? gotFetch() : undefined,
    rotate: () => {
      session += 1;
    },
    ...(proxy ? { rotatedDelayMs: 1000, maxRetries: 6 } : {}),
    minIntervalMs: 1000,
    timeoutMs: 45_000,
    maxRequestMs: 120_000,
    maxFailingMs: 180_000,
    log: (m) => log.warning(m),
  });

  const stats = await runJobs(input, {
    get: (url, expect) => client.get(url, expect),
    log: (m) => log.warning(m),
    monitor,
    emit: async (item, events) => {
      const res = await Actor.pushData(item, "job");
      if (res.eventChargeLimitReached) return false;
      if (events.includes("job-detail")) {
        const d = await Actor.charge({ eventName: "job-detail" });
        if (d.eventChargeLimitReached) return false;
      }
      return true;
    },
  }).finally(() => saveState?.());

  log.info(
    `Done after ${client.requests} requests (${client.blocks} blocked, ${client.errors} errors): ${JSON.stringify(stats)}`,
  );
  const failed = stats.searches.filter((s) => s.status === "failed").length;
  const notFound = stats.searches.filter((s) => s.status === "notFound").length;
  await Actor.setStatusMessage(
    `${stats.emitted} jobs` +
      (input.monitorMode
        ? ` (${stats.new} new, ${stats.updated} updated, ${stats.removed} removed; ${stats.unchanged} unchanged)`
        : "") +
      ` from ${stats.searches.length} search(es), ${stats.pages} page(s)` +
      (stats.details ? `, ${stats.details} job pages` : "") +
      (failed ? `, ${failed} failed` : "") +
      (notFound ? `, ${notFound} skill/city not found` : "") +
      (stats.stopReason === "budget" ? " (stopped at max charge)" : ""),
    { isStatusMessageTerminal: true },
  );
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
