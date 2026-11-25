import { Actor, log } from "apify";
import { HttpClient } from "./http.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { bookmakerCount } from "./match.js";
import { runMatches } from "./run.js";
import { OddsSeen, Seen, stateKey } from "./state.js";

export const MATCH_EVENT = "match";
export const ODDS_DETAIL_EVENT = "match-odds-detail";
/** Named (persistent) key-value store holding onlyNew state. */
export const STATE_STORE = "tennis-matches-odds-state";

await Actor.init();

try {
  let input;
  try {
    input = normalizeInput(await Actor.getInput<RawInput>());
  } catch (e) {
    if (e instanceof InputError) {
      await Actor.fail(`Invalid input: ${e.message}`);
    }
    throw e;
  }

  const upcoming = input.mode === "upcoming";
  log.info(
    (upcoming
      ? "Upcoming matches"
      : input.playerSlugs.length
        ? `Players ${input.playerSlugs.join(", ")}`
        : "Daily results") +
      `, ${input.startDate} to ${input.endDate}, tours ${input.tours.join(", ")}, up to ${input.maxMatches} matches` +
      (input.includeBookmakerOdds ? ", with bookmaker odds" : "") +
      (input.onlyNew
        ? upcoming
          ? ", only new or changed odds"
          : ", only new"
        : "") +
      ".",
  );

  let seen: Seen | undefined;
  let oddsSeen: OddsSeen | undefined;
  let saveState: (() => Promise<void>) | undefined;
  if (input.onlyNew) {
    const store = await Actor.openKeyValueStore(STATE_STORE);
    // Results-mode key unchanged from earlier versions (existing state).
    const key = upcoming
      ? stateKey({
          mode: "upcoming",
          tours: [...input.tours].sort(),
          includeBookmakerOdds: input.includeBookmakerOdds,
        })
      : stateKey({
          tours: [...input.tours].sort(),
          playerSlugs: [...input.playerSlugs].sort(),
        });
    const raw = await store.getValue(key);
    let size: number;
    if (upcoming) {
      const s = new OddsSeen(raw);
      oddsSeen = s;
      size = s.size;
      saveState = () => store.setValue(key, s.toJSON());
    } else {
      const s = new Seen(raw);
      seen = s;
      size = s.size;
      saveState = () => store.setValue(key, s.toJSON());
    }
    log.info(
      `Only new ${upcoming ? "matches or odds changes" : "matches"}: state "${key}" in store "${STATE_STORE}" (${size} known).`,
    );
  }

  const charging = Actor.getChargingManager();
  if (charging.getPricingInfo().isPayPerEvent) {
    const affordable =
      charging.calculateMaxEventChargeCountWithinLimit(MATCH_EVENT);
    if (affordable <= 0) {
      log.warning("Max charge per run is too low for a single match.");
      await Actor.exit();
    }
    if (affordable < input.maxMatches) {
      log.info(`Budget allows about ${affordable} matches.`);
    }
  }

  const http = new HttpClient({ log: (m) => log.warning(m) });

  const stats = await runMatches(input, {
    fetchPage: (url) => http.get(url),
    log: (m) => log.info(m),
    warn: (m) => log.warning(m),
    seen,
    oddsSeen,
    afterBatch: saveState,
    emit: async (item) => {
      const res = await Actor.pushData(item, MATCH_EVENT);
      if (res.eventChargeLimitReached) return false;
      if (bookmakerCount(item) > 0) {
        const r = await Actor.charge({ eventName: ODDS_DETAIL_EVENT });
        if (r.eventChargeLimitReached) return false;
      }
      return true;
    },
  });

  log.info(`Done after ${http.requests} requests: ${JSON.stringify(stats)}`);

  if (stats.emitted === 0 && stats.pagesFailed > 0) {
    await Actor.fail(
      `No matches returned and ${stats.pagesFailed} TennisExplorer page(s) failed: ${stats.errors.slice(0, 2).join("; ")}`,
    );
  }
  let msg = `Scraped ${stats.emitted} ${upcoming ? "upcoming " : ""}matches`;
  if (input.includeBookmakerOdds)
    msg += ` (${stats.withBookmakerOdds} with bookmaker odds)`;
  if (stats.stopReason === "budget") msg += " (stopped at max charge)";
  if (stats.stopReason === "maxMatches") msg += " (reached maxMatches)";
  if (stats.emitted === 0) {
    if (stats.skippedSeen)
      msg += upcoming
        ? `; no new matches or odds changes since the last run`
        : `; no new matches since the last run`;
    else if (stats.emptyDays.length)
      msg += `; TennisExplorer lists no matches for ${stats.emptyDays.join(", ")}`;
    else if (stats.skippedTour)
      msg += `; ${stats.skippedTour} matches were outside the selected tours`;
    else if (stats.skippedStarted)
      msg += `; all ${stats.skippedStarted} listed matches have already started`;
    else msg += `; no matches in the selected dates`;
    log.warning(msg);
  }
  if (stats.pagesFailed) msg += ` (${stats.pagesFailed} page(s) failed)`;
  await Actor.setStatusMessage(msg, { isStatusMessageTerminal: true });
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
