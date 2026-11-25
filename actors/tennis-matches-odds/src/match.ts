export const BASE_URL = "https://www.tennisexplorer.com";

/** Tour codes accepted in input and written to the `tour` field. */
export const TOURS = [
  "ATP",
  "WTA",
  "CHALLENGER",
  "ITF_MEN",
  "ITF_WOMEN",
  "OTHER_MEN",
  "OTHER_WOMEN",
  "ATP_DOUBLES",
  "WTA_DOUBLES",
] as const;
export type Tour = (typeof TOURS)[number];
export type Gender = "men" | "women";
export type Discipline = "singles" | "doubles";
/** One TennisExplorer list (results or upcoming matches page `type`). */
export type ListType =
  "atp-single" | "wta-single" | "atp-double" | "wta-double";

export const listTypeOf = (g: Gender, d: Discipline): ListType =>
  `${g === "men" ? "atp" : "wta"}-${d === "singles" ? "single" : "double"}`;

export interface Player {
  /** Name as listed, e.g. "Hurkacz H." (full name when the match detail was fetched). */
  name: string;
  /** TennisExplorer player slug (use it in `playerSlugs`). */
  slug: string | null;
  /** Country; only known in player mode, for the requested player. */
  country: string | null;
  /** Seed / entry label shown next to the name: "5", "Q", "WC", "LL"... */
  seed: string | null;
  /** Singles ranking shown on the match-detail page (needs includeBookmakerOdds). */
  rank: number | null;
}

export interface SetScore {
  player1: number;
  player2: number;
  /** Tiebreak points of the player who lost the tiebreak, as displayed. */
  tiebreak: number | null;
}

export interface BookmakerOdds {
  bookmaker: string;
  /** Latest (closing) odds for player1 / player2. */
  oddsHome: number | null;
  oddsAway: number | null;
  /** Earliest odds in the bookmaker's displayed movement history. */
  openingOddsHome: number | null;
  openingOddsAway: number | null;
}

export type MatchStatus = "completed" | "retired" | "walkover";

/** A finished match (results mode). */
export interface Match {
  matchId: string;
  /** YYYY-MM-DD (TennisExplorer default time zone, Central Europe). */
  date: string;
  /** HH:MM start time, when shown. */
  time: string | null;
  tournament: string;
  tournamentUrl: string | null;
  /** ISO 3166 alpha-2-ish flag code of the tournament ("CN", "US"...). */
  tournamentCountry: string | null;
  tour: Tour;
  surface: string | null;
  round: string | null;
  player1: Player;
  player2: Player;
  winner: "player1" | "player2" | null;
  winnerName: string | null;
  setsPlayer1: number | null;
  setsPlayer2: number | null;
  setScores: SetScore[];
  /** Human-readable score from player1's view, e.g. "6-7(8) 6-3 6-3". */
  score: string;
  status: MatchStatus;
  /** Always "finished" in results mode ("scheduled" for upcoming matches). */
  state: "finished";
  /** Closing odds for player1 / player2 as displayed by TennisExplorer. */
  oddsHome: number | null;
  oddsAway: number | null;
  /**
   * Doubles only: the two players of each side (player1/player2 then hold the
   * team as listed, e.g. "Krawietz K. / Puetz T."). null for singles.
   */
  team1: Player[] | null;
  team2: Player[] | null;
  /** Per-bookmaker home/away odds (only with includeBookmakerOdds). */
  bookmakerOdds?: BookmakerOdds[];
  url: string;
}

/** Pre-match odds of one bookmaker for an upcoming match. */
export interface UpcomingBookmaker {
  name: string;
  /** Current odds for player1 / team1 and player2 / team2. */
  home: number | null;
  away: number | null;
  /** Earliest odds in the bookmaker's displayed movement history. */
  openingHome: number | null;
  openingAway: number | null;
}

/** A scheduled, not yet started match (upcoming mode). */
export interface UpcomingMatch {
  matchId: string;
  /** YYYY-MM-DD, TennisExplorer's day (Central European time). */
  scheduledDate: string;
  /** HH:MM as shown by TennisExplorer; null when the time is not set yet. */
  startTime: string | null;
  /** Time zone of scheduledDate/startTime as shown by the site, e.g. "GMT+1". */
  timeZone: string;
  tournament: string;
  tournamentUrl: string | null;
  tournamentCountry: string | null;
  tour: Tour;
  surface: string | null;
  round: string | null;
  status: "scheduled";
  state: "scheduled";
  /** Singles players (null for doubles). */
  player1: Player | null;
  player2: Player | null;
  /** Doubles teams (null for singles). */
  team1: Player[] | null;
  team2: Player[] | null;
  /** Seed / entry label of side 1 / side 2: "5", "Q", "WC"... */
  seed1: string | null;
  seed2: string | null;
  /** Current pre-match odds (TennisExplorer average) for side 1 / side 2. */
  oddsHome: number | null;
  oddsAway: number | null;
  /** Per-bookmaker pre-match odds (only with includeBookmakerOdds). */
  bookmakers?: UpcomingBookmaker[];
  sourceUrl: string;
}

/** One dataset item. */
export type Item = Match | UpcomingMatch;

export const isUpcoming = (i: Item): i is UpcomingMatch =>
  i.state === "scheduled";

/** Number of per-bookmaker odds rows attached to an item. */
export const bookmakerCount = (i: Item): number =>
  isUpcoming(i) ? (i.bookmakers?.length ?? 0) : (i.bookmakerOdds?.length ?? 0);

export const matchUrl = (id: string) => `${BASE_URL}/match-detail/?id=${id}`;

/** Doubles tours are read from their own lists, never classified by name. */
export const isDoublesTour = (t: Tour): boolean =>
  t === "ATP_DOUBLES" || t === "WTA_DOUBLES";

const OTHER_RE =
  /\b(utr|exhibition|asian games|olympic|davis cup|billie jean|united cup|laver cup|hopman|world tennis league|six kings|next gen|university|youth)\b/i;

/** Classify a tournament into a tour from its name / URL. */
export function classifyTour(
  name: string,
  gender: Gender,
  url?: string | null,
  discipline: Discipline = "singles",
): Tour {
  if (discipline === "doubles")
    return gender === "men" ? "ATP_DOUBLES" : "WTA_DOUBLES";
  const s = `${name} ${url ?? ""}`;
  if (/challenger/i.test(s)) return "CHALLENGER";
  if (/\bitf\b|futures|-itf\b/i.test(s))
    return gender === "men" ? "ITF_MEN" : "ITF_WOMEN";
  if (OTHER_RE.test(name))
    return gender === "men" ? "OTHER_MEN" : "OTHER_WOMEN";
  return gender === "men" ? "ATP" : "WTA";
}

export const genderOfTour = (t: Tour): Gender =>
  t === "WTA" || t === "ITF_WOMEN" || t === "OTHER_WOMEN" || t === "WTA_DOUBLES"
    ? "women"
    : "men";

export const listTypeOfTour = (t: Tour): ListType =>
  listTypeOf(genderOfTour(t), isDoublesTour(t) ? "doubles" : "singles");

/** Is a set finished (6+ with a 2-game lead, 7-6, or a 10-8 match tiebreak)? */
export function setComplete(a: number, b: number): boolean {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (hi === 7 && lo === 6) return true;
  return hi >= 6 && hi - lo >= 2;
}

/**
 * Derive winner, status and the score string. Both TennisExplorer lists put
 * the winner first, so a player with more sets (or player1 on a retirement
 * without a set lead) is the winner.
 */
export function summarize(
  sets: SetScore[],
  setsP1: number | null,
  setsP2: number | null,
): {
  winner: "player1" | "player2" | null;
  status: MatchStatus;
  score: string;
} {
  const a = setsP1 ?? sets.filter((s) => s.player1 > s.player2).length;
  const b = setsP2 ?? sets.filter((s) => s.player2 > s.player1).length;
  const winner = a > b ? "player1" : b > a ? "player2" : null;
  let status: MatchStatus = "completed";
  if (!sets.length) status = "walkover";
  else {
    const last = sets[sets.length - 1]!;
    if (!setComplete(last.player1, last.player2)) status = "retired";
  }
  const score = sets
    .map(
      (s) =>
        `${s.player1}-${s.player2}` +
        (s.tiebreak !== null ? `(${s.tiebreak})` : ""),
    )
    .join(" ");
  return { winner, status, score };
}

export const toNumber = (s: string | undefined | null): number | null => {
  if (s === undefined || s === null) return null;
  const t = s.replace(/\u00a0/g, " ").trim();
  if (!t || !/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
};

/** Stable key order in the dataset, matching the schema. */
export function orderFields(m: Match): Match {
  const out: Match = {
    matchId: m.matchId,
    date: m.date,
    time: m.time,
    tournament: m.tournament,
    tournamentUrl: m.tournamentUrl,
    tournamentCountry: m.tournamentCountry,
    tour: m.tour,
    surface: m.surface,
    round: m.round,
    player1: m.player1,
    player2: m.player2,
    team1: m.team1,
    team2: m.team2,
    winner: m.winner,
    winnerName: m.winnerName,
    setsPlayer1: m.setsPlayer1,
    setsPlayer2: m.setsPlayer2,
    setScores: m.setScores,
    score: m.score,
    status: m.status,
    state: m.state,
    oddsHome: m.oddsHome,
    oddsAway: m.oddsAway,
    url: m.url,
  };
  if (m.bookmakerOdds) out.bookmakerOdds = m.bookmakerOdds;
  return out;
}

/** Stable key order for upcoming matches, matching the schema. */
export function orderUpcomingFields(m: UpcomingMatch): UpcomingMatch {
  const out: UpcomingMatch = {
    matchId: m.matchId,
    scheduledDate: m.scheduledDate,
    startTime: m.startTime,
    timeZone: m.timeZone,
    tournament: m.tournament,
    tournamentUrl: m.tournamentUrl,
    tournamentCountry: m.tournamentCountry,
    tour: m.tour,
    surface: m.surface,
    round: m.round,
    status: m.status,
    state: m.state,
    player1: m.player1,
    player2: m.player2,
    team1: m.team1,
    team2: m.team2,
    seed1: m.seed1,
    seed2: m.seed2,
    oddsHome: m.oddsHome,
    oddsAway: m.oddsAway,
    sourceUrl: m.sourceUrl,
  };
  if (m.bookmakers) out.bookmakers = m.bookmakers;
  return out;
}
