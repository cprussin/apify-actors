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
] as const;
export type Tour = (typeof TOURS)[number];
export type Gender = "men" | "women";

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
  /** Closing odds for player1 / player2 as displayed by TennisExplorer. */
  oddsHome: number | null;
  oddsAway: number | null;
  /** Per-bookmaker home/away odds (only with includeBookmakerOdds). */
  bookmakerOdds?: BookmakerOdds[];
  url: string;
}

export const matchUrl = (id: string) => `${BASE_URL}/match-detail/?id=${id}`;

const OTHER_RE =
  /\b(utr|exhibition|asian games|olympic|davis cup|billie jean|united cup|laver cup|hopman|world tennis league|six kings|next gen|university|youth)\b/i;

/** Classify a tournament into a tour from its name / URL. */
export function classifyTour(
  name: string,
  gender: Gender,
  url?: string | null,
): Tour {
  const s = `${name} ${url ?? ""}`;
  if (/challenger/i.test(s)) return "CHALLENGER";
  if (/\bitf\b|futures|-itf\b/i.test(s))
    return gender === "men" ? "ITF_MEN" : "ITF_WOMEN";
  if (OTHER_RE.test(name))
    return gender === "men" ? "OTHER_MEN" : "OTHER_WOMEN";
  return gender === "men" ? "ATP" : "WTA";
}

export const genderOfTour = (t: Tour): Gender =>
  t === "WTA" || t === "ITF_WOMEN" || t === "OTHER_WOMEN" ? "women" : "men";

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
    winner: m.winner,
    winnerName: m.winnerName,
    setsPlayer1: m.setsPlayer1,
    setsPlayer2: m.setsPlayer2,
    setScores: m.setScores,
    score: m.score,
    status: m.status,
    oddsHome: m.oddsHome,
    oddsAway: m.oddsAway,
    url: m.url,
  };
  if (m.bookmakerOdds) out.bookmakerOdds = m.bookmakerOdds;
  return out;
}
