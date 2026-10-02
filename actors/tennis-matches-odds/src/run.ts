import { datesDesc, type NormalizedInput } from "./input.js";
import {
  BASE_URL,
  genderOfTour,
  matchUrl,
  orderFields,
  type Gender,
  type Match,
} from "./match.js";
import {
  applyDetail,
  parseMatchDetail,
  parsePlayerPage,
  parseResultsPage,
  parseTournamentPage,
  type TournamentInfo,
} from "./parse.js";
import type { Seen } from "./state.js";

export interface RunDeps {
  /** GET a TennisExplorer page; null = 404. Throws on persistent failure. */
  fetchPage: (url: string) => Promise<string | null>;
  /** Push + charge one match. Return `false` to stop (e.g. budget exhausted). */
  emit: (m: Match) => Promise<boolean>;
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
  /** onlyNew mode: skip previously returned matches and record new ones. */
  seen?: Seen;
  /** Called after each page of matches, e.g. to persist onlyNew state. */
  afterBatch?: () => Promise<void>;
}

export interface RunStats {
  emitted: number;
  withBookmakerOdds: number;
  pagesOk: number;
  pagesFailed: number;
  /** Results pages that said "no matches" for that day. */
  emptyDays: string[];
  skippedTour: number;
  skippedSeen: number;
  playersNotFound: string[];
  errors: string[];
  stopReason: "done" | "maxMatches" | "budget";
}

const TYPE: Record<Gender, string> = { men: "atp-single", women: "wta-single" };

export const resultsUrl = (gender: Gender, date: string): string => {
  const [y, m, d] = date.split("-");
  return `${BASE_URL}/results/?type=${TYPE[gender]}&year=${y}&month=${m}&day=${d}`;
};

export const playerUrl = (slug: string, year: number): string =>
  `${BASE_URL}/player/${encodeURIComponent(slug)}/?annual=${year}`;

class Stop extends Error {
  constructor(readonly reason: RunStats["stopReason"]) {
    super(reason);
  }
}

export async function runMatches(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const warn = deps.warn ?? log;
  const stats: RunStats = {
    emitted: 0,
    withBookmakerOdds: 0,
    pagesOk: 0,
    pagesFailed: 0,
    emptyDays: [],
    skippedTour: 0,
    skippedSeen: 0,
    playersNotFound: [],
    errors: [],
    stopReason: "done",
  };
  const emitted = new Set<string>();
  const tournaments = new Map<string, TournamentInfo | null>();
  const tours = new Set(input.tours);

  const fail = (what: string, e: unknown) => {
    const msg = `${what}: ${(e as Error).message.slice(0, 300)}`;
    stats.pagesFailed += 1;
    stats.errors.push(msg);
    warn(msg);
  };

  async function tournamentInfo(url: string): Promise<TournamentInfo | null> {
    if (tournaments.has(url)) return tournaments.get(url)!;
    let info: TournamentInfo | null = null;
    try {
      const html = await deps.fetchPage(url);
      if (html) {
        info = parseTournamentPage(html);
        stats.pagesOk += 1;
      }
    } catch (e) {
      fail(`Tournament page ${url} (round/surface left empty)`, e);
    }
    tournaments.set(url, info);
    return info;
  }

  /** Enrich, emit and record a batch of candidate matches. */
  async function emitAll(candidates: Match[]): Promise<void> {
    for (const c of candidates) {
      if (emitted.has(c.matchId)) continue;
      if (!tours.has(c.tour)) {
        stats.skippedTour += 1;
        continue;
      }
      if (deps.seen?.has(c.matchId)) {
        stats.skippedSeen += 1;
        continue;
      }
      let m = c;
      if (input.includeBookmakerOdds) {
        try {
          const html = await deps.fetchPage(matchUrl(m.matchId));
          if (html) {
            m = applyDetail(m, parseMatchDetail(html), true);
            stats.pagesOk += 1;
          } else m = { ...m, bookmakerOdds: [] };
        } catch (e) {
          fail(`Match detail ${m.matchId} (bookmaker odds left empty)`, e);
          m = { ...m, bookmakerOdds: [] };
        }
      }
      if (
        input.includeRoundAndSurface &&
        (m.round === null || m.surface === null) &&
        m.tournamentUrl
      ) {
        const info = await tournamentInfo(m.tournamentUrl);
        let round = m.round ?? info?.rounds[m.matchId] ?? null;
        // Qualifying matches are listed on a separate page.
        if (round === null && info?.hasQualification) {
          const q = await tournamentInfo(
            `${m.tournamentUrl}${m.tournamentUrl.includes("?") ? "&" : "?"}phase=qualification`,
          );
          round = q?.rounds[m.matchId] ?? null;
        }
        m = { ...m, surface: m.surface ?? info?.surface ?? null, round };
      }
      const more = await deps.emit(orderFields(m));
      emitted.add(m.matchId);
      stats.emitted += 1;
      if (m.bookmakerOdds?.length) stats.withBookmakerOdds += 1;
      deps.seen?.add(m.matchId, m.date);
      if (!more) throw new Stop("budget");
      if (stats.emitted >= input.maxMatches) throw new Stop("maxMatches");
    }
  }

  try {
    if (input.playerSlugs.length) {
      const y0 = Number(input.startDate.slice(0, 4));
      const y1 = Number(input.endDate.slice(0, 4));
      for (const slug of input.playerSlugs) {
        for (let y = y1; y >= y0; y--) {
          let html: string | null;
          try {
            html = await deps.fetchPage(playerUrl(slug, y));
          } catch (e) {
            fail(`Player ${slug} ${y}`, e);
            continue;
          }
          if (html === null) {
            stats.playersNotFound.push(slug);
            warn(`Player "${slug}" not found on TennisExplorer; skipping.`);
            break;
          }
          let page;
          try {
            page = parsePlayerPage(html, y, slug);
          } catch (e) {
            fail(`Player ${slug} ${y}`, e);
            continue;
          }
          stats.pagesOk += 1;
          const inRange = page.matches
            .filter((m) => m.date >= input.startDate && m.date <= input.endDate)
            .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
          log(
            `${page.name ?? slug} ${y}: ${page.matches.length} singles matches, ${inRange.length} in range.`,
          );
          await emitAll(inRange);
          await deps.afterBatch?.();
        }
      }
    } else {
      const genders = [...new Set(input.tours.map(genderOfTour))];
      for (const date of datesDesc(input.startDate, input.endDate)) {
        for (const g of genders) {
          const url = resultsUrl(g, date);
          let page;
          try {
            const html = await deps.fetchPage(url);
            if (html === null) throw new Error("HTTP 404");
            page = parseResultsPage(html, date, g);
          } catch (e) {
            fail(`Results ${TYPE[g]} ${date}`, e);
            continue;
          }
          stats.pagesOk += 1;
          if (page.noMatches) {
            stats.emptyDays.push(`${date} ${TYPE[g]}`);
            warn(`TennisExplorer lists no ${TYPE[g]} matches on ${date}.`);
          }
          log(`${date} ${TYPE[g]}: ${page.matches.length} matches listed.`);
          await emitAll(page.matches);
          await deps.afterBatch?.();
        }
      }
    }
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    stats.stopReason = e.reason;
    await deps.afterBatch?.();
  }

  if (stats.pagesOk === 0 && stats.pagesFailed > 0) {
    throw new Error(
      `Every TennisExplorer request failed: ${stats.errors.slice(0, 3).join("; ")}`,
    );
  }
  if (
    input.playerSlugs.length &&
    stats.playersNotFound.length === input.playerSlugs.length
  ) {
    throw new Error(
      `None of the players were found: ${input.playerSlugs.join(", ")}. Use the slug from the player's TennisExplorer URL, e.g. "hurkacz" for https://www.tennisexplorer.com/player/hurkacz/.`,
    );
  }
  return stats;
}
