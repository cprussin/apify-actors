import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import {
  BASE_URL,
  classifyTour,
  matchUrl,
  summarize,
  toNumber,
  type BookmakerOdds,
  type Gender,
  type Match,
  type Player,
  type SetScore,
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

export interface ResultsPage {
  matches: Match[];
  /** The page says there are no matches on this day. */
  noMatches: boolean;
}

/** Parse /results/?type=atp-single|wta-single&year=&month=&day= */
export function parseResultsPage(
  html: string,
  date: string,
  gender: Gender,
): ResultsPage {
  const $ = cheerio.load(html);
  const table = $("li.dNav").closest("ul.tabs").nextAll("table.result").first();
  if (!table.length)
    throw new LayoutError("Results table not found on TennisExplorer page.");
  const noMatches = table.find("td.no-data").length > 0;
  const matches: Match[] = [];
  const seen = new Set<string>();
  let tournament = "";
  let tournamentUrl: string | null = null;
  let tournamentCountry: string | null = null;

  for (const node of table.find("tr").toArray()) {
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
    const detail = tr.find('a[href*="match-detail/?id="]').last().attr("href");
    const matchId = /id=(\d+)/.exec(detail ?? "")?.[1];
    if (!matchId || seen.has(matchId)) continue;
    seen.add(matchId);

    const timeText = clean(tr.find("td.time").first().text());
    const time = /^\d{1,2}:\d{2}$/.test(timeText) ? timeText : null;
    const p1 = playerFrom(tr.find("td.t-name").first());
    const p2 = playerFrom(trB.find("td.t-name").first());
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
    const odds = tr.find("td.course, td.coursew").toArray();
    const s = summarize(sets, setsP1, setsP2);
    matches.push({
      matchId,
      date,
      time,
      tournament,
      tournamentUrl,
      tournamentCountry,
      tour: classifyTour(tournament, gender, tournamentUrl),
      surface: null,
      round: null,
      player1: p1,
      player2: p2,
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
      oddsHome: toNumber(odds[0] ? $(odds[0]).text() : null),
      oddsAway: toNumber(odds[1] ? $(odds[1]).text() : null),
      url: matchUrl(matchId),
    });
  }
  const rows = table.find("tr[id]").length;
  if (!matches.length && rows > 0)
    throw new LayoutError(
      `Could not parse any of ${rows} rows on the results page.`,
    );
  return { matches, noMatches: noMatches || rows === 0 };
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
  const hasQualification =
    center.find('a[href*="phase=qualification"]').length > 0;
  return { surface, rounds, hasQualification };
}

export interface MatchDetail {
  date: string | null;
  time: string | null;
  round: string | null;
  surface: string | null;
  /** Players in the order shown on the detail page. */
  players: { slug: string | null; fullName: string; rank: number | null }[];
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
  const ths = header.find("thead th.plName").toArray();
  const rankRow = header
    .find("tbody tr")
    .filter((_, tr) => /singles ranking/i.test($(tr).find("th").text()));
  const rank = (sel: string) => {
    const n = /^(\d+)\.?$/.exec(clean(rankRow.find(sel).first().text()));
    return n ? Number(n[1]) : null;
  };
  const players = ths.map((th, i) => {
    const a = $(th).find("a").first();
    return {
      slug: slugOf(a.attr("href")),
      fullName: clean(a.text() || $(th).text()),
      rank: rank(i === 0 ? "td.tr" : "td.tl"),
    };
  });
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
  return { date, time, round, surface, players, bookmakerOdds };
}

/**
 * Apply a match detail to a match: round, surface, full names, ranks and
 * bookmaker odds (swapped if the detail page lists the players the other way).
 */
export function applyDetail(
  m: Match,
  d: MatchDetail,
  withOdds: boolean,
): Match {
  const [d1, d2] = d.players;
  const swapped =
    !!d1?.slug &&
    !!d2?.slug &&
    d1.slug === m.player2.slug &&
    d2.slug === m.player1.slug;
  const byP1 = swapped ? d2 : d1;
  const byP2 = swapped ? d1 : d2;
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
  };
  out.winnerName =
    out.winner === "player1"
      ? out.player1.name
      : out.winner === "player2"
        ? out.player2.name
        : null;
  if (withOdds) {
    out.bookmakerOdds = d.bookmakerOdds.map((o) =>
      swapped
        ? {
            bookmaker: o.bookmaker,
            oddsHome: o.oddsAway,
            oddsAway: o.oddsHome,
            openingOddsHome: o.openingOddsAway,
            openingOddsAway: o.openingOddsHome,
          }
        : o,
    );
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
      oddsHome: toNumber(odds[0] ? $(odds[0]).text() : null),
      oddsAway: toNumber(odds[1] ? $(odds[1]).text() : null),
      url: matchUrl(matchId),
    });
  }
  return { name, country, matches };
}
