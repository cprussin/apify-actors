import { Actor, log } from "apify";
import { gotFetch } from "./got-fetch.js";
import { InstahyreClient } from "./http.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { runJobs } from "./run.js";
import { MonitorState, stateKey } from "./state.js";

export const CHARGE_EVENT = "job";
/** Named (persistent) key-value store holding monitorMode state. */
export const STATE_STORE = "instahyre-jobs-state";

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
    `Searching: ${JSON.stringify({ ...input, maxItems: undefined, monitorMode: undefined })}, up to ${input.maxItems} jobs` +
      (input.monitorMode ? ", monitor mode" : "") +
      ".",
  );

  // monitorMode: state is keyed by the filters, so each distinct input (e.g.
  // each scheduled task) tracks its own set of jobs.
  let state: MonitorState | undefined;
  let saveState: (() => Promise<void>) | undefined;
  if (input.monitorMode) {
    const store = await Actor.openKeyValueStore(STATE_STORE);
    const lower = (xs: string[]) => xs.map((x) => x.toLowerCase()).sort();
    const key = stateKey({
      skills: lower(input.skills),
      locations: lower(input.locations),
      years: input.years,
      jobFunctions: lower(input.jobFunctions),
      companySize: input.companySize,
      jobType: input.jobType,
    });
    const s = new MonitorState(await store.getValue(key));
    state = s;
    saveState = () => store.setValue(key, s.toJSON());
    Actor.on("persistState", saveState);
    log.info(
      `Monitor mode: state "${key}" in store "${STATE_STORE}" (${s.size} known jobs${s.isBaseline ? ", first run: every job is new" : ""}).`,
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
  const prefix = `ih${Math.floor(Math.random() * 1e8)}`;
  let session = 0;
  if (proxy) log.info("Using Apify Proxy.");
  // One request at a time, at most ~1 per second: polite to instahyre.com.
  const client = new InstahyreClient({
    fetch: gotFetch(
      proxy ? () => proxy.newUrl(`${prefix}_${session}`) : undefined,
    ),
    fallbackFetch: proxy ? gotFetch() : undefined,
    rotate: () => {
      session += 1;
    },
    ...(proxy ? { rotatedDelayMs: 1000, maxRetries: 6 } : {}),
    minIntervalMs: 1000,
    timeoutMs: 30_000,
    maxRequestMs: 90_000,
    maxFailingMs: 180_000,
    log: (m) => log.warning(m),
  });

  let stats;
  try {
    stats = await runJobs(input, {
      get: (url) => client.get(url),
      log: (m) => log.warning(m),
      state,
      emit: async (item) => {
        const res = await Actor.pushData(item, CHARGE_EVENT);
        return !res.eventChargeLimitReached;
      },
    }).finally(() => saveState?.());
  } catch (e) {
    if (e instanceof InputError)
      await Actor.fail(`Invalid input: ${e.message}`);
    throw e;
  }

  log.info(
    `Done after ${client.requests} requests (${client.blocks} blocked, ${client.errors} errors): ${JSON.stringify(stats)}`,
  );
  await Actor.setStatusMessage(
    `${stats.emitted} jobs from ${stats.pages} page(s)` +
      (stats.totalJobs !== null ? ` (${stats.totalJobs} matching)` : "") +
      (stats.filteredOut ? `, ${stats.filteredOut} outside locations` : "") +
      (state
        ? `; monitor: ${stats.unchanged} unchanged, ${stats.removed} removed`
        : "") +
      (stats.stopReason === "budget" ? " (stopped at max charge)" : "") +
      (stats.stopReason === "error" ? ` (stopped: ${stats.error})` : ""),
    { isStatusMessageTerminal: true },
  );
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
