import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import {
  BASE_URL,
  classifyTour,
  matchUrl,
  summarize,
  toNumber,
  type BookmakerOdds,
  type Discipline,
  type Gender,
  type Match,
  type Player,
  type SetScore,
  type UpcomingMatch,
} from "./match.js";

/** The page doesn't look like a TennisExplorer page we understand. */
export class LayoutError extends Error {}

type El = cheerio.Cheerio<AnyNode>;

const clean = (s: string | undefined | null): string =>
  (s ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const absUrl = (href: string | undefined): string | null =>
  href ? new URL(href, BASE_URL).toString() : null;

/** "/player/hurkacz/" or "/player/hurkacz" -> "hurkacz". */
export function slugOf(href: string | undefined): string | null {
  const m = /\/player\/([^/?#]+)/.exec(href ?? "");
  return m ? decodeURIComponent(m[1]!) : null;
}

const SURFACES = ["hard", "clay", "grass", "indoors", "carpet"];

export function normalizeSurface(s: string | undefined | null): string | null {
  const t = clean(s).toLowerCase();
  return SURFACES.includes(t) ? t : null;
}

const ROUNDS: Record<string, string> = {
  "1. round": "1R",
  "2. round": "2R",
  "3. round": "3R",
  "4. round": "4R",
  "round of 128": "R128",
  "round of 64": "R64",
  "round of 32": "R32",
  "round of 16": "R16",
  quarterfinal: "QF",
  semifinal: "SF",
  final: "F",
  "round robin": "RR",
  "bronze medal": "3rd",
  "1. round qualification": "Q1",
  "2. round qualification": "Q2",
  "3. round qualification": "Q3",
  qualification: "Q",
};

/** Normalize a round label ("semifinal", "1. round", "SF") to a short code. */
export function normalizeRound(s: string | undefined | null): string | null {
  const t = clean(s);
  if (!t || t.toLowerCase() === "round") return null;
  const q = /^qualification\s*-\s*(.+)$/i.exec(t);
  if (q) return `Q-${ROUNDS[q[1]!.toLowerCase()] ?? q[1]}`;
  return ROUNDS[t.toLowerCase()] ?? t;
}

function flagCode(el: El): string | null {
  const cls = el.find("span.fl").attr("class") ?? "";
  const m = /\bfl-([a-z]{2})\b/.exec(cls);
  return m ? m[1]!.toUpperCase() : null;
}

/** Score cell like `6<sup>8</sup>` -> { games: 6, tb: 8 }. */
function scoreCell(td: El): { games: number | null; tb: number | null } {
  const sup = td.find("sup");
  const tb = sup.length ? toNumber(sup.text()) : null;
  const games = toNumber(clean(td.clone().find("sup").remove().end().text()));
  return { games, tb };
}

function playerFrom(td: El): Player {
  const a = td.find("a").first();
  const seed = /\(([^)]+)\)\s*$/.exec(clean(td.text()));
  return {
    name: clean(a.length ? a.text() : td.text().replace(/\([^)]*\)\s*$/, "")),
    slug: slugOf(a.attr("href")),
    country: null,
    seed: seed ? seed[1]! : null,
    rank: null,
  };
}

/**
 * A doubles cell: `<a href="/doubles-team/krawietz/puetz/" title="Krawietz K.
 * / Puetz T.">Krawietz K / Puetz T</a> (3)`. Returns the team as one side
 * (name "Krawietz K. / Puetz T.", team seed) plus its two players.
 */
export function teamFrom(td: El): { side: Player; team: Player[] } {
  const a = td.find("a").first();
  const seed = /\(([^)]+)\)\s*$/.exec(clean(td.text()));
  const label = clean(
    a.attr("title") ||
      (a.length ? a.text() : td.text().replace(/\([^)]*\)\s*$/, "")),
  );
  const m = /\/doubles-team\/([^/?#]+)\/([^/?#]+)/.exec(a.attr("href") ?? "");
  const slugs = m ? [m[1]!, m[2]!].map((s) => decodeURIComponent(s)) : [];
  const team = label
    .split(/\s+\/\s+|\s*\/\s*/)
    .filter(Boolean)
    .map((name, i) => ({
      name,
      slug: slugs[i] ?? null,
      country: null,
      seed: null,
      rank: null,
    }));
  return {
    side: {
      name: label,
      slug: null,
      country: null,
      seed: seed?.[1] ?? null,
      rank: null,
    },
    team,
  };
}

/** One match of a results or upcoming-matches list (two table rows). */
interface ListRow {
  tr: El;
  trB: El;
  matchId: string;
  tournament: string;
  tournamentUrl: string | null;
  tournamentCountry: string | null;
  /** Leading HH:MM of the time cell, if any. */
  time: string | null;
  /** Time cell is exactly HH:MM (results pages). */
  exactTime: boolean;
  side1: Player;
  side2: Player;
  team1: Player[] | null;
  team2: Player[] | null;
  oddsHome: number | null;
  oddsAway: number | null;
}

function listRows(
  $: cheerio.CheerioAPI,
  tables: El,
  discipline: Discipline,
): ListRow[] {
  const out: ListRow[] = [];
  const seen = new Set<string>();
  for (const t of tables.toArray()) {
    let tournament = "";
    let tournamentUrl: string | null = null;
    let tournamentCountry: string | null = null;
    for (const node of $(t).find("tr").toArray()) {
      const tr = $(node);
      if (tr.hasClass("head")) {
        const td = tr.find("td.t-name").first();
        tournament = clean(td.text());
        tournamentUrl = absUrl(td.find("a").attr("href"));
        tournamentCountry = flagCode(td);
        continue;
      }
      const id = tr.attr("id");
      if (!id || !/^r\d+$/.test(id)) continue;
      const trB = tr.next(`tr#${id}b`);
      if (!trB.length) continue;
      const detail = tr
        .find('a[href*="match-detail/?id="]')
        .last()
        .attr("href");
      const matchId = /id=(\d+)/.exec(detail ?? "")?.[1];
      if (!matchId || seen.has(matchId)) continue;
      seen.add(matchId);
      const timeText = clean(tr.find("td.time").first().text());
      const time = /^(\d{1,2}:\d{2})\b/.exec(timeText)?.[1] ?? null;
      const tdA = tr.find("td.t-name").first();
      const tdB = trB.find("td.t-name").first();
      let side1: Player;
      let side2: Player;
      let team1: Player[] | null = null;
      let team2: Player[] | null = null;
      if (discipline === "doubles") {
        const a = teamFrom(tdA);
        const b = teamFrom(tdB);
        [side1, side2, team1, team2] = [a.side, b.side, a.team, b.team];
      } else {
        side1 = playerFrom(tdA);
        side2 = playerFrom(tdB);
      }
      const odds = tr.find("td.course, td.coursew").toArray();
      out.push({
        tr,
        trB,
        matchId,
        tournament,
        tournamentUrl,
        tournamentCountry,
        time,
        exactTime: /^\d{1,2}:\d{2}$/.test(timeText),
        side1,
        side2,
        team1,
        team2,
        oddsHome: toNumber(odds[0] ? $(odds[0]).text() : null),
        oddsAway: toNumber(odds[1] ? $(odds[1]).text() : null),
      });
    }
  }
  return out;
}

export interface ResultsPage {
  matches: Match[];
  /** The page says there are no matches on this day. */
  noMatches: boolean;
}

/** Parse /results/?type=atp-single|wta-single|atp-double|wta-double&year=&month=&day= */
export function parseResultsPage(
  html: string,
  date: string,
  gender: Gender,
  discipline: Discipline = "singles",
): ResultsPage {
  const $ = cheerio.load(html);
  const table = $("li.dNav").closest("ul.tabs").nextAll("table.result").first();
  if (!table.length)
    throw new LayoutError("Results table not found on TennisExplorer page.");
  const noMatches = table.find("td.no-data").length > 0;
  const matches: Match[] = [];

  for (const r of listRows($, table, discipline)) {
    const { tr, trB, side1: p1, side2: p2 } = r;
    const setsP1 = toNumber(tr.find("td.result").first().text());
    const setsP2 = toNumber(trB.find("td.result").first().text());
    const cellsA = tr.find("td.score").toArray();
    const cellsB = trB.find("td.score").toArray();
    const sets: SetScore[] = [];
    for (let i = 0; i < Math.min(cellsA.length, cellsB.length); i++) {
      const a = scoreCell($(cellsA[i]!));
      const b = scoreCell($(cellsB[i]!));
      if (a.games === null || b.games === null) continue;
      sets.push({ player1: a.games, player2: b.games, tiebreak: a.tb ?? b.tb });
    }
    const s = summarize(sets, setsP1, setsP2);
    matches.push({
      matchId: r.matchId,
      date,
      time: r.exactTime ? r.time : null,
      tournament: r.tournament,
      tournamentUrl: r.tournamentUrl,
      tournamentCountry: r.tournamentCountry,
      tour: classifyTour(r.tournament, gender, r.tournamentUrl, discipline),
      surface: null,
      round: null,
      player1: p1,
      player2: p2,
      team1: r.team1,
      team2: r.team2,
      winner: s.winner,
      winnerName:
        s.winner === "player1"
          ? p1.name
          : s.winner === "player2"
            ? p2.name
            : null,
      setsPlayer1: setsP1,
      setsPlayer2: setsP2,
      setScores: sets,
      score: s.score,
      status: s.status,
      state: "finished",
      oddsHome: r.oddsHome,
      oddsAway: r.oddsAway,
      url: matchUrl(r.matchId),
    });
  }
  const rows = table.find("tr[id]").length;
  if (!matches.length && rows > 0)
    throw new LayoutError(
      `Could not parse any of ${rows} rows on the results page.`,
    );
  return { matches, noMatches: noMatches || rows === 0 };
}

export interface UpcomingPage {
  /** Matches that have not started yet. */
  matches: UpcomingMatch[];
  /** Listed matches skipped because they are live or finished. */
  started: number;
  /** The page says there are no matches on this day. */
  noMatches: boolean;
}

/** Fallback when the page does not show its time zone. */
export const DEFAULT_TIME_ZONE = "GMT+1";

/** "26. 11. 2026" -> "2026-11-26". */
function tabDate(s: string): string | null {
  const m = /(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/.exec(s);
  return m
    ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`
    : null;
}

/**
 * Parse /matches/?type=atp-single|wta-single|atp-double|wta-double&year=&month=&day=
 * (same table layout as /results/, odds cells, no score yet). Today's page can
 * also list yesterday's late matches in a separate box and live or finished
 * matches; only matches of `date` that have not started are returned.
 */
export function parseUpcomingPage(
  html: string,
  date: string,
  gender: Gender,
  discipline: Discipline = "singles",
): UpcomingPage {
  const $ = cheerio.load(html);
  const boxes = $("li.dNav")
    .closest("ul.tabs")
    .toArray()
    .map((ul) => ({
      date: tabDate(clean($(ul).find("li.set .tab, li.set").first().text())),
      table: $(ul).nextAll("table.result").first(),
    }))
    .filter((b) => b.table.length);
  if (!boxes.length)
    throw new LayoutError("Matches table not found on TennisExplorer page.");
  const dated = boxes.filter((b) => b.date === date);
  // Layout without readable tab dates: fall back to every box.
  const use = dated.length || boxes.some((b) => b.date) ? dated : boxes;
  const tables = $(use.map((b) => b.table.get(0)!));
  const timeZone =
    clean($("span.timezone").first().text()) || DEFAULT_TIME_ZONE;
  const matches: UpcomingMatch[] = [];
  let started = 0;
  const rows = listRows($, tables, discipline);
  for (const r of rows) {
    const scored = [r.tr, r.trB].some(
      (row) =>
        toNumber(clean(row.find("td.result").first().text())) !== null ||
        row
          .find("td.score")
          .toArray()
          .some((c) => scoreCell($(c)).games !== null),
    );
    if (scored) {
      started += 1;
      continue;
    }
    const doubles = discipline === "doubles";
    matches.push({
      matchId: r.matchId,
      scheduledDate: date,
      startTime: r.time,
      timeZone,
      tournament: r.tournament,
      tournamentUrl: r.tournamentUrl,
      tournamentCountry: r.tournamentCountry,
      tour: classifyTour(r.tournament, gender, r.tournamentUrl, discipline),
      surface: null,
      round: null,
      status: "scheduled",
      state: "scheduled",
      player1: doubles ? null : r.side1,
      player2: doubles ? null : r.side2,
      team1: r.team1,
      team2: r.team2,
      seed1: r.side1.seed,
      seed2: r.side2.seed,
      oddsHome: r.oddsHome,
      oddsAway: r.oddsAway,
      sourceUrl: matchUrl(r.matchId),
    });
  }
  const listed = tables.find("tr[id]").length;
  if (!rows.length && listed > 0)
    throw new LayoutError(
      `Could not parse any of ${listed} rows on the matches page.`,
    );
  const noData = tables.find("td.no-data").length > 0;
  return { matches, started, noMatches: noData || listed === 0 };
}

export interface TournamentInfo {
  surface: string | null;
  /** matchId -> short round code */
  rounds: Record<string, string>;
  /** The page links to a separate qualification draw. */
  hasQualification: boolean;
}

/** Parse a tournament page (/porto-challenger/2026/atp-men/). */
export function parseTournamentPage(html: string): TournamentInfo {
  const $ = cheerio.load(html);
  const center = $("#center");
  if (!center.length) throw new LayoutError("Tournament page layout changed.");
  let surface: string | null = null;
  const info = clean(center.find(".box.boxBasic").first().text());
  const m = /^\((.*)\)$/.exec(info);
  if (m) {
    for (const part of m[1]!.split(/,\s+/)) {
      surface ??= normalizeSurface(part);
    }
  }
  const rounds: Record<string, string> = {};
  center.find("table.result tr[id]").each((_, node) => {
    const tr = $(node);
    if (!/^r\d+$/.test(tr.attr("id") ?? "")) return;
    const href = tr.find('a[href*="match-detail/?id="]').last().attr("href");
    const id = /id=(\d+)/.exec(href ?? "")?.[1];
    const tds = tr.find("td");
    const td = tds.eq(1);
    const round = normalizeRound(td.text() || td.attr("title"));
    if (id && round) rounds[id] = round;
  });
  // Scheduled matches: rows without an id, round in td.round.
  center.find("table.result tr").each((_, node) => {
    const tr = $(node);
    if (tr.attr("id")) return;
    const href = tr.find('a[href*="match-detail/?id="]').first().attr("href");
    const id = /id=(\d+)/.exec(href ?? "")?.[1];
    const td = tr.children("td.round").first();
    const round = td.length
      ? normalizeRound(td.text() || td.attr("title"))
      : null;
    if (id && round && !rounds[id]) rounds[id] = round;
  });
  const hasQualification =
    center.find('a[href*="phase=qualification"]').length > 0;
  return { surface, rounds, hasQualification };
}

export interface DetailPlayer {
  slug: string | null;
  fullName: string;
  rank: number | null;
}

export interface MatchDetail {
  date: string | null;
  time: string | null;
  round: string | null;
  surface: string | null;
  /** Players in the order shown on the detail page (doubles: first of each team). */
  players: DetailPlayer[];
  /** Doubles only: [side 1 players, side 2 players]. */
  teams: [DetailPlayer[], DetailPlayer[]] | null;
  bookmakerOdds: BookmakerOdds[];
}

function oddsCell(td: El): { close: number | null; open: number | null } {
  const box = td.find(".odds-in").first();
  const close = toNumber(
    clean(box.clone().children().remove().end().text()) || null,
  );
  const hist = box.find(".odds-change-div tr");
  let open: number | null = null;
  if (hist.length) open = toNumber(clean(hist.last().find("td.bold").text()));
  return { close, open };
}

/** Parse /match-detail/?id= */
export function parseMatchDetail(html: string): MatchDetail {
  const $ = cheerio.load(html);
  const center = $("#center");
  const header = center.find("table.gDetail");
  if (!center.length || !header.length)
    throw new LayoutError("Match detail layout changed.");
  const parts = clean(center.find(".box.boxBasic").first().text()).split(
    /,\s+/,
  );
  const dm = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(parts[0] ?? "");
  const date = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : null;
  const time = /^\d{1,2}:\d{2}$/.test(parts[1] ?? "") ? parts[1]! : null;
  let surface: string | null = null;
  let round: string | null = null;
  const rest = parts.slice(3);
  if (rest.length) {
    surface = normalizeSurface(rest[rest.length - 1]);
    const r = surface ? rest.slice(0, -1) : rest;
    round = normalizeRound(r.join(", ")) ?? null;
  }
  // One table per pair of opponents: singles has one, doubles two.
  const pairs = header.toArray().map((table) => {
    const t = $(table);
    const rows = t.find("tbody tr");
    const byLabel = (re: RegExp) =>
      rows.filter((_, tr) => re.test($(tr).find("th").text()));
    let rankRow = byLabel(/singles ranking/i);
    if (!rankRow.length) rankRow = byLabel(/doubles ranking/i);
    const rank = (sel: string) => {
      const n = /^(\d+)\.?$/.exec(clean(rankRow.find(sel).first().text()));
      return n ? Number(n[1]) : null;
    };
    return t
      .find("thead th.plName")
      .toArray()
      .slice(0, 2)
      .map((th, i): DetailPlayer => {
        const a = $(th).find("a").first();
        return {
          slug: slugOf(a.attr("href")),
          fullName: clean(a.text() || $(th).text()),
          rank: rank(i === 0 ? "td.tr" : "td.tl"),
        };
      });
  });
  const players = pairs[0] ?? [];
  const teams: MatchDetail["teams"] =
    pairs.length >= 2
      ? [
          pairs.map((p) => p[0]).filter((p): p is DetailPlayer => !!p),
          pairs.map((p) => p[1]).filter((p): p is DetailPlayer => !!p),
        ]
      : null;
  const bookmakerOdds: BookmakerOdds[] = [];
  $("#oddsMenu-1-data table.result")
    .first()
    .children("tbody")
    .children("tr")
    .each((_, node) => {
      const tr = $(node);
      if (
        tr.hasClass("head") ||
        tr.hasClass("average") ||
        tr.hasClass("highest")
      )
        return;
      const name =
        clean(tr.children("td.first").find(".t").text()) ||
        clean(tr.children("td.first").text());
      if (!name || /^(average|highest)/i.test(name)) return;
      const h = oddsCell(tr.children("td.k1"));
      const a = oddsCell(tr.children("td.k2"));
      if (h.close === null && a.close === null) return;
      bookmakerOdds.push({
        bookmaker: name,
        oddsHome: h.close,
        oddsAway: a.close,
        openingOddsHome: h.open,
        openingOddsAway: a.open,
      });
    });
  return { date, time, round, surface, players, teams, bookmakerOdds };
}

/**
 * Which detail-page side belongs to our side 1 / side 2. `swapped` when the
 * detail page lists the sides the other way round (matched by player slugs).
 */
function detailSides(
  d: MatchDetail,
  slugs1: (string | null)[],
  slugs2: (string | null)[],
): { swapped: boolean; side1: DetailPlayer[]; side2: DetailPlayer[] } {
  const [a, b] = d.teams ?? [
    d.players[0] ? [d.players[0]] : [],
    d.players[1] ? [d.players[1]] : [],
  ];
  const all = (ps: DetailPlayer[], slugs: (string | null)[]) =>
    ps.length > 0 && ps.every((p) => !!p.slug && slugs.includes(p.slug));
  const swapped = all(a, slugs2) && all(b, slugs1);
  return swapped
    ? { swapped, side1: b, side2: a }
    : { swapped, side1: a, side2: b };
}

/** Fill full names and ranks of team members (by slug, else by position). */
function enrichTeam(team: Player[], ps: DetailPlayer[]): Player[] {
  return team.map((p, i) => {
    const d = ps.find((x) => !!x.slug && x.slug === p.slug) ?? ps[i];
    return d ? { ...p, name: d.fullName || p.name, rank: d.rank ?? p.rank } : p;
  });
}

const swapOdds = (o: BookmakerOdds): BookmakerOdds => ({
  bookmaker: o.bookmaker,
  oddsHome: o.oddsAway,
  oddsAway: o.oddsHome,
  openingOddsHome: o.openingOddsAway,
  openingOddsAway: o.openingOddsHome,
});

/**
 * Apply a match detail to a match: round, surface, full names, ranks and
 * bookmaker odds (swapped if the detail page lists the players the other way).
 * Doubles keep the listed team names and enrich `team1`/`team2`.
 */
export function applyDetail(
  m: Match,
  d: MatchDetail,
  withOdds: boolean,
): Match {
  const doubles = !!m.team1 && !!m.team2;
  const { swapped, side1, side2 } = doubles
    ? detailSides(
        d,
        m.team1!.map((p) => p.slug),
        m.team2!.map((p) => p.slug),
      )
    : detailSides(d, [m.player1.slug], [m.player2.slug]);
  const byP1 = doubles ? undefined : side1[0];
  const byP2 = doubles ? undefined : side2[0];
  const out: Match = {
    ...m,
    round: m.round ?? d.round,
    surface: m.surface ?? d.surface,
    time: m.time ?? d.time,
    player1: {
      ...m.player1,
      name: byP1?.fullName || m.player1.name,
      rank: byP1?.rank ?? m.player1.rank,
    },
    player2: {
      ...m.player2,
      name: byP2?.fullName || m.player2.name,
      rank: byP2?.rank ?? m.player2.rank,
    },
    team1: m.team1 ? enrichTeam(m.team1, side1) : null,
    team2: m.team2 ? enrichTeam(m.team2, side2) : null,
  };
  out.winnerName =
    out.winner === "player1"
      ? out.player1.name
      : out.winner === "player2"
        ? out.player2.name
        : null;
  if (withOdds) {
    out.bookmakerOdds = d.bookmakerOdds.map((o) => (swapped ? swapOdds(o) : o));
  }
  return out;
}

/**
 * Apply a match detail to an upcoming match: round, surface, full names,
 * ranks and (withOdds) per-bookmaker pre-match odds, oriented to side 1/2.
 */
export function applyUpcomingDetail(
  m: UpcomingMatch,
  d: MatchDetail,
  withOdds: boolean,
): UpcomingMatch {
  const doubles = !!m.team1 && !!m.team2;
  const { swapped, side1, side2 } = doubles
    ? detailSides(
        d,
        m.team1!.map((p) => p.slug),
        m.team2!.map((p) => p.slug),
      )
    : detailSides(d, [m.player1?.slug ?? null], [m.player2?.slug ?? null]);
  const single = (p: Player | null, x: DetailPlayer | undefined) =>
    p && x ? { ...p, name: x.fullName || p.name, rank: x.rank ?? p.rank } : p;
  const out: UpcomingMatch = {
    ...m,
    round: m.round ?? d.round,
    surface: m.surface ?? d.surface,
    startTime: m.startTime ?? d.time,
    player1: doubles ? m.player1 : single(m.player1, side1[0]),
    player2: doubles ? m.player2 : single(m.player2, side2[0]),
    team1: m.team1 ? enrichTeam(m.team1, side1) : null,
    team2: m.team2 ? enrichTeam(m.team2, side2) : null,
  };
  if (withOdds) {
    out.bookmakers = d.bookmakerOdds.map((o) => {
      const x = swapped ? swapOdds(o) : o;
      // No movement history shown = the price has not moved since opening.
      return {
        name: x.bookmaker,
        home: x.oddsHome,
        away: x.oddsAway,
        openingHome: x.openingOddsHome ?? x.oddsHome,
        openingAway: x.openingOddsAway ?? x.oddsAway,
      };
    });
  }
  return out;
}

export interface PlayerPage {
  name: string | null;
  country: string | null;
  matches: Match[];
}

/** Parse the set list of a score link like `6<sup>8</sup>-7, 6-3`. */
export function parseScoreHtml(html: string): SetScore[] {
  const sets: SetScore[] = [];
  const text = html
    .replace(/<sup>\s*(\d+)\s*<\/sup>/g, "[$1]")
    .replace(/<[^>]+>/g, "");
  for (const part of text.split(",")) {
    const m = /^\s*(\d+)(?:\[(\d+)\])?\s*-\s*(\d+)(?:\[(\d+)\])?\s*$/.exec(
      part,
    );
    if (!m) continue;
    const tb = m[2] ?? m[4];
    sets.push({
      player1: Number(m[1]),
      player2: Number(m[3]),
      tiebreak: tb !== undefined ? Number(tb) : null,
    });
  }
  return sets;
}

/** Parse /player/<slug>/?annual=<year> (singles matches of that year). */
export function parsePlayerPage(
  html: string,
  year: number,
  slug: string,
): PlayerPage {
  const $ = cheerio.load(html);
  const center = $("#center");
  if (!center.length) throw new LayoutError("Player page layout changed.");
  const name = clean(center.find("table.plDetail h3").first().text()) || null;
  let country: string | null = null;
  center.find("table.plDetail .date").each((_, el) => {
    const m = /^Country:\s*(.+)$/.exec(clean($(el).text()));
    if (m) country = m[1]!;
  });
  const sex = center
    .find("table.plDetail .date")
    .filter((_, el) => /^Sex:/.test(clean($(el).text())))
    .text();
  const gender: Gender = /woman/i.test(sex) ? "women" : "men";

  const matches: Match[] = [];
  const table = $(`#matches-${year}-1-data table.result`).first();
  let tournament = "";
  let tournamentUrl: string | null = null;
  let tournamentCountry: string | null = null;
  const seen = new Set<string>();
  for (const node of table.find("tr").toArray()) {
    const tr = $(node);
    if (tr.hasClass("head")) {
      const td = tr.find("td.t-name").first();
      tournament = clean(td.text());
      tournamentUrl = absUrl(td.find("a").attr("href"));
      tournamentCountry = flagCode(td);
      continue;
    }
    const link = tr.find('a[href*="match-detail/?id="]').first();
    const matchId = /id=(\d+)/.exec(link.attr("href") ?? "")?.[1];
    if (!matchId || seen.has(matchId)) continue;
    seen.add(matchId);
    const dm = /^(\d{2})\.(\d{2})\.$/.exec(clean(tr.find("td.time").text()));
    if (!dm) continue;
    const date = `${year}-${dm[2]}-${dm[1]}`;
    const names = tr.find("td.t-name a").toArray();
    const mk = (i: number): Player => {
      const a = names[i] ? $(names[i]!) : null;
      const s = a ? slugOf(a.attr("href")) : null;
      return {
        name: a ? clean(a.text()) : "",
        slug: s,
        country: s === slug ? country : null,
        seed: null,
        rank: null,
      };
    };
    const p1 = mk(0);
    const p2 = mk(1);
    const sets = parseScoreHtml(link.html() ?? "");
    const s = summarize(sets, null, null);
    const winner =
      sets.length || /w\/?o|walkover/i.test(link.text()) ? "player1" : s.winner;
    const status = /ret/i.test(link.text()) ? "retired" : s.status;
    const surf = normalizeSurface(tr.find("td.s-color span").attr("title"));
    const roundTd = tr.find("td.round");
    const odds = tr.find("td.course").toArray();
    matches.push({
      matchId,
      date,
      time: null,
      tournament,
      tournamentUrl,
      tournamentCountry,
      tour: classifyTour(tournament, gender, tournamentUrl),
      surface: surf,
      round: normalizeRound(roundTd.text() || roundTd.attr("title")),
      player1: p1,
      player2: p2,
      team1: null,
      team2: null,
      winner,
      winnerName:
        winner === "player1" ? p1.name : winner === "player2" ? p2.name : null,
      setsPlayer1: sets.length
        ? sets.filter((x) => x.player1 > x.player2).length
        : null,
      setsPlayer2: sets.length
        ? sets.filter((x) => x.player2 > x.player1).length
        : null,
      setScores: sets,
      score: s.score,
      status,
      state: "finished",
      oddsHome: toNumber(odds[0] ? $(odds[0]).text() : null),
      oddsAway: toNumber(odds[1] ? $(odds[1]).text() : null),
      url: matchUrl(matchId),
    });
  }
  return { name, country, matches };
}
