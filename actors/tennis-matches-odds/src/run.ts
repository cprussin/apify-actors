import { datesAsc, datesDesc, type NormalizedInput } from "./input.js";
import {
  BASE_URL,
  genderOfTour,
  isDoublesTour,
  listTypeOf,
  listTypeOfTour,
  matchUrl,
  orderFields,
  orderUpcomingFields,
  type Discipline,
  type Gender,
  type Item,
  type ListType,
  type Match,
  type UpcomingMatch,
} from "./match.js";
import {
  applyDetail,
  applyUpcomingDetail,
  parseMatchDetail,
  parsePlayerPage,
  parseResultsPage,
  parseTournamentPage,
  parseUpcomingPage,
  type TournamentInfo,
} from "./parse.js";
import { oddsHash, type OddsSeen, type Seen } from "./state.js";

export interface RunDeps {
  /** GET a TennisExplorer page; null = 404. Throws on persistent failure. */
  fetchPage: (url: string) => Promise<string | null>;
  /** Push + charge one item. Return `false` to stop (e.g. budget exhausted). */
  emit: (m: Item) => Promise<boolean>;
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
  /** Results-mode onlyNew: skip previously returned matches, record new ones. */
  seen?: Seen;
  /** Upcoming-mode onlyNew: skip matches whose odds did not change. */
  oddsSeen?: OddsSeen;
  /** Called after each page of matches, e.g. to persist onlyNew state. */
  afterBatch?: () => Promise<void>;
}

export interface RunStats {
  emitted: number;
  withBookmakerOdds: number;
  pagesOk: number;
  pagesFailed: number;
  /** List pages that said "no matches" for that day. */
  emptyDays: string[];
  skippedTour: number;
  /** onlyNew: already returned (results) or odds unchanged (upcoming). */
  skippedSeen: number;
  /** Upcoming mode: listed matches that are already live or finished. */
  skippedStarted: number;
  playersNotFound: string[];
  errors: string[];
  stopReason: "done" | "maxMatches" | "budget";
}

const dateParams = (date: string): string => {
  const [y, m, d] = date.split("-");
  return `year=${y}&month=${m}&day=${d}`;
};

export const resultsUrl = (
  gender: Gender,
  date: string,
  discipline: Discipline = "singles",
): string =>
  `${BASE_URL}/results/?type=${listTypeOf(gender, discipline)}&${dateParams(date)}`;

export const upcomingUrl = (
  gender: Gender,
  date: string,
  discipline: Discipline = "singles",
): string =>
  `${BASE_URL}/matches/?type=${listTypeOf(gender, discipline)}&${dateParams(date)}`;

export const playerUrl = (slug: string, year: number): string =>
  `${BASE_URL}/player/${encodeURIComponent(slug)}/?annual=${year}`;

/** The TennisExplorer lists to read for these tours (singles first). */
export function listsFor(
  tours: NormalizedInput["tours"],
): { gender: Gender; discipline: Discipline; type: ListType }[] {
  const seen = new Set<ListType>();
  const out: { gender: Gender; discipline: Discipline; type: ListType }[] = [];
  const sorted = [...tours].sort(
    (a, b) => Number(isDoublesTour(a)) - Number(isDoublesTour(b)),
  );
  for (const t of sorted) {
    const type = listTypeOfTour(t);
    if (seen.has(type)) continue;
    seen.add(type);
    out.push({
      gender: genderOfTour(t),
      discipline: isDoublesTour(t) ? "doubles" : "singles",
      type,
    });
  }
  return out;
}

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
    skippedStarted: 0,
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

  /** Round and surface from the tournament page (and its qualifying draw). */
  async function roundAndSurface<
    T extends {
      matchId: string;
      round: string | null;
      surface: string | null;
      tournamentUrl: string | null;
    },
  >(m: T): Promise<T> {
    if (
      !input.includeRoundAndSurface ||
      (m.round !== null && m.surface !== null) ||
      !m.tournamentUrl
    )
      return m;
    const info = await tournamentInfo(m.tournamentUrl);
    let round = m.round ?? info?.rounds[m.matchId] ?? null;
    // Qualifying matches are listed on a separate page.
    if (round === null && info?.hasQualification) {
      const q = await tournamentInfo(
        `${m.tournamentUrl}${m.tournamentUrl.includes("?") ? "&" : "?"}phase=qualification`,
      );
      round = q?.rounds[m.matchId] ?? null;
    }
    return { ...m, surface: m.surface ?? info?.surface ?? null, round };
  }

  function record(id: string, bookmakers: number): void {
    emitted.add(id);
    stats.emitted += 1;
    if (bookmakers) stats.withBookmakerOdds += 1;
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
      m = await roundAndSurface(m);
      const more = await deps.emit(orderFields(m));
      record(m.matchId, m.bookmakerOdds?.length ?? 0);
      deps.seen?.add(m.matchId, m.date);
      if (!more) throw new Stop("budget");
      if (stats.emitted >= input.maxMatches) throw new Stop("maxMatches");
    }
  }

  /** Upcoming mode: enrich, compare odds (onlyNew), emit and record. */
  async function emitUpcoming(candidates: UpcomingMatch[]): Promise<void> {
    for (const c of candidates) {
      if (emitted.has(c.matchId)) continue;
      if (!tours.has(c.tour)) {
        stats.skippedTour += 1;
        continue;
      }
      let m = c;
      if (input.includeBookmakerOdds) {
        try {
          const html = await deps.fetchPage(matchUrl(m.matchId));
          if (html) {
            m = applyUpcomingDetail(m, parseMatchDetail(html), true);
            stats.pagesOk += 1;
          } else m = { ...m, bookmakers: [] };
        } catch (e) {
          fail(`Match detail ${m.matchId} (bookmaker odds left empty)`, e);
          m = { ...m, bookmakers: [] };
        }
      }
      const hash = oddsHash(m);
      if (deps.oddsSeen?.unchanged(m.matchId, hash)) {
        emitted.add(m.matchId);
        stats.skippedSeen += 1;
        continue;
      }
      m = await roundAndSurface(m);
      const more = await deps.emit(orderUpcomingFields(m));
      record(m.matchId, m.bookmakers?.length ?? 0);
      deps.oddsSeen?.add(m.matchId, hash, m.scheduledDate);
      if (!more) throw new Stop("budget");
      if (stats.emitted >= input.maxMatches) throw new Stop("maxMatches");
    }
  }

  try {
    if (input.mode === "upcoming") {
      const lists = listsFor(input.tours);
      for (const date of datesAsc(input.startDate, input.endDate)) {
        for (const l of lists) {
          const url = upcomingUrl(l.gender, date, l.discipline);
          let page;
          try {
            const html = await deps.fetchPage(url);
            if (html === null) throw new Error("HTTP 404");
            page = parseUpcomingPage(html, date, l.gender, l.discipline);
          } catch (e) {
            fail(`Matches ${l.type} ${date}`, e);
            continue;
          }
          stats.pagesOk += 1;
          stats.skippedStarted += page.started;
          if (page.noMatches) {
            stats.emptyDays.push(`${date} ${l.type}`);
            warn(`TennisExplorer lists no ${l.type} matches on ${date}.`);
          }
          log(
            `${date} ${l.type}: ${page.matches.length} scheduled matches listed` +
              (page.started
                ? ` (${page.started} live or finished skipped)`
                : "") +
              ".",
          );
          await emitUpcoming(page.matches);
          await deps.afterBatch?.();
        }
      }
    } else if (input.playerSlugs.length) {
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
      const lists = listsFor(input.tours);
      for (const date of datesDesc(input.startDate, input.endDate)) {
        for (const l of lists) {
          const url = resultsUrl(l.gender, date, l.discipline);
          let page;
          try {
            const html = await deps.fetchPage(url);
            if (html === null) throw new Error("HTTP 404");
            page = parseResultsPage(html, date, l.gender, l.discipline);
          } catch (e) {
            fail(`Results ${l.type} ${date}`, e);
            continue;
          }
          stats.pagesOk += 1;
          if (page.noMatches) {
            stats.emptyDays.push(`${date} ${l.type}`);
            warn(`TennisExplorer lists no ${l.type} matches on ${date}.`);
          }
          log(`${date} ${l.type}: ${page.matches.length} matches listed.`);
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
