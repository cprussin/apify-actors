import { Actor, log } from "apify";
import { AppleClient } from "./apple.js";
import { GoogleClient } from "./google.js";
import { HttpClient } from "./http.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { RankTracker, stateKey } from "./ranks.js";
import { APP_EVENT, RANK_EVENT, runApps } from "./run.js";

/** Named (persistent) key-value store holding rank-changes state. */
export const STATE_STORE = "app-store-apps-ranks";

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
    (input.mode === "keywordRanks"
      ? `App Store keyword ranks for ${input.keywords.length} keyword(s), top ${input.maxResults}` +
        (input.trackedApps.length
          ? `, tracking ${input.trackedApps.length} app(s)`
          : "")
      : input.mode === "topCharts"
        ? `Top charts ${input.charts.join(", ")} (${input.category}) on ${input.stores.join(", ")}, top ${input.maxResults}`
        : `Details for ${input.apps.length} app(s)`) +
      `, country ${input.country}` +
      (input.rankChangesOnly ? ", rank changes only" : "") +
      ".",
  );

  // Rank changes: state is keyed by the query, so each distinct input (e.g.
  // each scheduled task) diffs against its own previous run.
  let tracker: RankTracker | undefined;
  let saveState: (() => Promise<void>) | undefined;
  if (input.rankChangesOnly) {
    const store = await Actor.openKeyValueStore(STATE_STORE);
    const key = stateKey(
      input.mode === "keywordRanks"
        ? {
            mode: input.mode,
            keywords: input.keywords.map((k) => k.toLowerCase()).sort(),
            trackedApps: [...input.trackedApps].sort(),
            country: input.country,
            maxResults: input.maxResults,
          }
        : {
            mode: input.mode,
            charts: [...input.charts].sort(),
            stores: [...input.stores].sort(),
            category: input.category,
            country: input.country,
            maxResults: input.maxResults,
          },
    );
    const t = new RankTracker(await store.getValue(key));
    tracker = t;
    saveState = () => store.setValue(key, t.toJSON());
    log.info(`Rank changes only: state "${key}" in store "${STATE_STORE}".`);
  }

  const event = input.mode === "appDetails" ? APP_EVENT : RANK_EVENT;
  const charging = Actor.getChargingManager();
  const ppe = charging.getPricingInfo().isPayPerEvent;
  if (ppe && charging.calculateMaxEventChargeCountWithinLimit(event) <= 0) {
    log.warning("Max charge per run is too low for a single result.");
    await Actor.exit();
  }

  const http = new HttpClient({ log: (m) => log.warning(m) });
  const stats = await runApps(input, {
    apple: new AppleClient(http, (m) => log.warning(m)),
    google: new GoogleClient(http),
    tracker,
    afterGroup: saveState,
    log: (m) => log.warning(m),
    emit: async (row, ev) => {
      if (!ev) {
        await Actor.pushData(row);
        return true;
      }
      const res = await Actor.pushData(row, ev);
      return !res.eventChargeLimitReached;
    },
  });

  log.info(`Done after ${http.requests} requests: ${JSON.stringify(stats)}`);
  const noun = input.mode === "appDetails" ? "apps" : "rank rows";
  await Actor.setStatusMessage(
    `${stats.charged} ${noun}` +
      (stats.unchanged ? `, ${stats.unchanged} unchanged ranks skipped` : "") +
      (stats.failed.length ? `, ${stats.failed.length} failed (free)` : "") +
      (stats.stopReason === "budget" ? " (stopped at max charge)" : ""),
    { isStatusMessageTerminal: true },
  );
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
