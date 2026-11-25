import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  InputError,
  datesDesc,
  normalizeInput,
  parseDate,
  parsePlayerSlug,
  type RawInput,
} from "../src/input.js";
import { matchUrl, type Match, type UpcomingMatch } from "../src/match.js";
import { playerUrl, resultsUrl, runMatches, upcomingUrl } from "../src/run.js";
import { OddsSeen, Seen, oddsHash, stateKey } from "../src/state.js";

const fx = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const NOW = new Date("2026-09-29T10:00:00Z");

const PAGES: Record<string, string> = {
  [resultsUrl("men", "2026-09-28")]: fx("results-atp-2026-09-28.html"),
  [resultsUrl("women", "2026-09-28")]: fx("results-wta-2026-09-28.html"),
  [resultsUrl("men", "2026-12-25")]: fx("results-empty.html"),
  [resultsUrl("women", "2026-12-25")]: fx("results-empty.html"),
  "https://www.tennisexplorer.com/porto-challenger/2026/atp-men/": fx(
    "tournament-porto-challenger-2026.html",
  ),
  "https://www.tennisexplorer.com/match-detail/?id=3334240": fx(
    "match-detail-3334240.html",
  ),
  [playerUrl("hurkacz", 2026)]: fx("player-hurkacz-2026.html"),
};

function harness(raw: RawInput, opts: { seen?: Seen; budget?: number } = {}) {
  const out: Match[] = [];
  const requested: string[] = [];
  const warnings: string[] = [];
  const input = normalizeInput(raw, NOW);
  const run = runMatches(input, {
    fetchPage: async (url) => {
      requested.push(url);
      if (url in PAGES) return PAGES[url]!;
      if (url.includes("/player/")) return null;
      if (url.includes("match-detail")) throw new Error("HTTP 503");
      // Other tournament pages: minimal valid page without data.
      return '<div id="center"><div class="box boxBasic">(1 €, clay, men)</div></div>';
    },
    emit: async (m) => {
      out.push(m as Match);
      return opts.budget === undefined || out.length < opts.budget;
    },
    warn: (m) => warnings.push(m),
    seen: opts.seen,
  });
  return { run, out, requested, warnings };
}

/** Upcoming mode: 2026-11-25 13:00 UTC (14:00 in Prague). */
const NOW_UP = new Date("2026-11-25T13:00:00Z");
const FLORIANOPOLIS =
  "https://www.tennisexplorer.com/florianopolis-challenger/2026/atp-men/";

const UP_PAGES: Record<string, string> = {
  [upcomingUrl("men", "2026-11-25")]: fx("matches-atp-2026-11-25-today.html"),
  [upcomingUrl("men", "2026-11-26")]: fx("matches-atp-2026-11-26.html"),
  [upcomingUrl("men", "2026-11-26", "doubles")]: fx(
    "matches-atp-double-2026-11-26.html",
  ),
  [FLORIANOPOLIS]: fx("tournament-florianopolis-challenger-2026.html"),
  [matchUrl("3388457")]: fx("match-detail-3388457.html"),
  [matchUrl("3388857")]: fx("match-detail-3388857.html"),
};

function upHarness(
  raw: RawInput,
  opts: { oddsSeen?: OddsSeen; pages?: Record<string, string> } = {},
) {
  const out: UpcomingMatch[] = [];
  const requested: string[] = [];
  const pages = opts.pages ?? UP_PAGES;
  const input = normalizeInput({ mode: "upcoming", ...raw }, NOW_UP);
  const run = runMatches(input, {
    fetchPage: async (url) => {
      requested.push(url);
      if (url in pages) return pages[url]!;
      if (url.includes("match-detail")) throw new Error("HTTP 503");
      if (url.includes("/matches/")) return fx("results-empty.html");
      return '<div id="center"><div class="box boxBasic">(1 €, hard, men)</div></div>';
    },
    emit: async (m) => {
      out.push(m as UpcomingMatch);
      return true;
    },
    oddsSeen: opts.oddsSeen,
  });
  return { run, out, requested };
}

describe("input", () => {
  it("defaults to yesterday, ATP + WTA", () => {
    expect(normalizeInput({}, NOW)).toEqual({
      mode: "results",
      daysAhead: 1,
      startDate: "2026-09-28",
      endDate: "2026-09-28",
      tours: ["ATP", "WTA"],
      playerSlugs: [],
      includeRoundAndSurface: true,
      includeBookmakerOdds: false,
      onlyNew: false,
      maxMatches: 500,
    });
  });

  it("parses dates, relative dates, slugs and tours", () => {
    expect(parseDate("7 days", NOW, "x")).toBe("2026-09-22");
    expect(parseDate("yesterday", NOW, "x")).toBe("2026-09-28");
    expect(parseDate("", NOW, "x")).toBeUndefined();
  });

  it("rejects bad input", () => {
    expect(() => parseDate("2026-02-30", NOW, "x")).toThrow(InputError);
    expect(() => normalizeInput({ tours: ["NBA"] }, NOW)).toThrow(InputError);
    expect(() =>
      normalizeInput({ startDate: "2026-09-28", endDate: "2026-09-01" }, NOW),
    ).toThrow(InputError);
    expect(() => normalizeInput({ maxMatches: 0 }, NOW)).toThrow(InputError);
    expect(() => parsePlayerSlug("not a slug!")).toThrow(InputError);
  });

  it("upcoming mode: today (Prague time) plus daysAhead; doubles tours", () => {
    expect(
      normalizeInput(
        { mode: "upcoming", tours: ["atp doubles", "WTA"] },
        NOW_UP,
      ),
    ).toMatchObject({
      mode: "upcoming",
      daysAhead: 1,
      startDate: "2026-11-25",
      endDate: "2026-11-26",
      tours: ["ATP_DOUBLES", "WTA"],
    });
    // 23:30 UTC is already the next day in Prague; dates in input are ignored.
    expect(
      normalizeInput(
        { mode: "Upcoming", daysAhead: "7", startDate: "1 year" },
        new Date("2026-11-25T23:30:00Z"),
      ),
    ).toMatchObject({ startDate: "2026-11-26", endDate: "2026-12-03" });
  });

  it("rejects bad upcoming input", () => {
    for (const daysAhead of [0, 8, 1.5, "x"])
      expect(() =>
        normalizeInput({ mode: "upcoming", daysAhead }, NOW_UP),
      ).toThrow(InputError);
    expect(() => normalizeInput({ mode: "live" }, NOW)).toThrow(InputError);
    expect(() =>
      normalizeInput({ mode: "upcoming", playerSlugs: ["hurkacz"] }, NOW),
    ).toThrow(/results" mode only/);
  });

  it("player mode defaults to the start of the year; clamps future end dates", () => {
    const i = normalizeInput(
      {
        playerSlugs: [
          "https://www.tennisexplorer.com/player/hurkacz/",
          "hurkacz",
        ],
        endDate: "2027-01-01",
        tours: ["atp", "itf men"],
      },
      NOW,
    );
    expect(i).toMatchObject({
      playerSlugs: ["hurkacz"],
      startDate: "2026-01-01",
      endDate: "2026-09-29",
      tours: ["ATP", "ITF_MEN"],
    });
    expect(datesDesc("2026-09-27", "2026-09-29")).toEqual([
      "2026-09-29",
      "2026-09-28",
      "2026-09-27",
    ]);
  });
});

describe("runMatches", () => {
  it("default input: ATP + WTA main-tour matches with round/surface lookups", async () => {
    const h = harness({});
    const stats = await h.run;
    expect(h.out.length).toBeGreaterThan(20);
    expect(h.out.every((m) => m.tour === "ATP" || m.tour === "WTA")).toBe(true);
    expect(stats.skippedTour).toBeGreaterThan(200);
    // 2 results pages + one page per distinct tournament.
    const tournaments = new Set(h.out.map((m) => m.tournamentUrl));
    expect(h.requested.length).toBe(2 + tournaments.size);
    expect(h.out[0]!.surface).not.toBeNull();
    expect(h.out[0]).not.toHaveProperty("bookmakerOdds");
    expect(Object.keys(h.out[0]!)[0]).toBe("matchId");
  });

  it("challenger rounds come from the tournament page", async () => {
    const h = harness({ tours: ["CHALLENGER"], maxMatches: 1000 });
    await h.run;
    const m = h.out.find((x) => x.matchId === "3333630")!;
    expect(m).toMatchObject({ round: "1R", surface: "hard" });
  });

  it("maxMatches stops early", async () => {
    const h = harness({ tours: ["ATP", "CHALLENGER"], maxMatches: 3 });
    const stats = await h.run;
    expect(h.out.length).toBe(3);
    expect(stats.stopReason).toBe("maxMatches");
    expect(h.requested.filter((u) => u.includes("/results/")).length).toBe(1);
  });

  it("stops when the budget is exhausted", async () => {
    const h = harness({ tours: ["ATP"] }, { budget: 2 });
    const stats = await h.run;
    expect(h.out.length).toBe(2);
    expect(stats.stopReason).toBe("budget");
  });

  it("bookmaker odds: failed detail pages give empty odds, not failure", async () => {
    const h = harness({
      tours: ["ATP"],
      includeBookmakerOdds: true,
      maxMatches: 3,
    });
    const stats = await h.run;
    const m = h.out.find((x) => x.matchId === "3334240");
    expect(h.out.length).toBe(3);
    if (m) expect(m.bookmakerOdds!.length).toBe(15);
    expect(h.out.every((x) => Array.isArray(x.bookmakerOdds))).toBe(true);
    expect(stats.pagesFailed).toBe(stats.emitted - stats.withBookmakerOdds);
  });

  it("empty day with explicit dates is not an error", async () => {
    const input = {
      ...normalizeInput({}, NOW),
      startDate: "2026-12-25",
      endDate: "2026-12-25",
    };
    const warnings: string[] = [];
    const stats = await runMatches(input, {
      fetchPage: async (u) => PAGES[u] ?? null,
      emit: async () => true,
      warn: (m) => warnings.push(m),
    });
    expect(stats.emitted).toBe(0);
    expect(stats.emptyDays).toEqual([
      "2026-12-25 atp-single",
      "2026-12-25 wta-single",
    ]);
    expect(warnings.join()).toMatch(/no atp-single matches on 2026-12-25/);
  });

  it("fails when every request fails", async () => {
    await expect(
      runMatches(normalizeInput({}, NOW), {
        fetchPage: async () => {
          throw new Error("HTTP 503");
        },
        emit: async () => true,
      }),
    ).rejects.toThrow(/Every TennisExplorer request failed/);
    await expect(
      runMatches(normalizeInput({}, NOW), {
        fetchPage: async () => "<html>captcha</html>",
        emit: async () => true,
      }),
    ).rejects.toThrow(/Every TennisExplorer request failed/);
  });

  it("onlyNew skips matches returned before", async () => {
    const seen = new Seen(undefined);
    const a = harness({ tours: ["ATP"] }, { seen });
    await a.run;
    expect(a.out.length).toBeGreaterThan(0);
    const reloaded = new Seen(JSON.parse(JSON.stringify(seen)));
    const b = harness({ tours: ["ATP"] }, { seen: reloaded });
    const stats = await b.run;
    expect(b.out.length).toBe(0);
    expect(stats.skippedSeen).toBe(a.out.length);
  });

  it("player mode: matches in range, newest first, unknown players skipped", async () => {
    const h = harness({
      playerSlugs: ["hurkacz", "nobody-xyz"],
      startDate: "2026-09-01",
      tours: ["ATP", "CHALLENGER", "OTHER_MEN"],
    });
    const stats = await h.run;
    expect(stats.playersNotFound).toEqual(["nobody-xyz"]);
    expect(h.out.length).toBeGreaterThan(3);
    expect(h.out.every((m) => m.date >= "2026-09-01")).toBe(true);
    const dates = h.out.map((m) => m.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(h.out[0]).toMatchObject({ date: "2026-09-28", round: "SF" });
    // Round and surface come from the player page: no tournament requests.
    expect(h.requested.every((u) => u.includes("/player/"))).toBe(true);
  });

  it("player mode fails when no player exists", async () => {
    await expect(harness({ playerSlugs: ["nobody-xyz"] }).run).rejects.toThrow(
      /None of the players were found/,
    );
  });
});

describe("runMatches doubles results", () => {
  it("reads the doubles list only for doubles tours", async () => {
    const requested: string[] = [];
    const out: Match[] = [];
    const input = normalizeInput(
      {
        tours: ["ATP_DOUBLES"],
        startDate: "2026-11-24",
        endDate: "2026-11-24",
        includeRoundAndSurface: false,
      },
      NOW_UP,
    );
    await runMatches(input, {
      fetchPage: async (u) => {
        requested.push(u);
        return u === resultsUrl("men", "2026-11-24", "doubles")
          ? fx("results-atp-double-2026-11-24.html")
          : null;
      },
      emit: async (m) => (out.push(m as Match), true),
    });
    expect(requested).toEqual([
      "https://www.tennisexplorer.com/results/?type=atp-double&year=2026&month=11&day=24",
    ]);
    expect(out.length).toBe(3);
    expect(
      out.every((m) => m.tour === "ATP_DOUBLES" && m.team1?.length === 2),
    ).toBe(true);
    expect(out[0]).toMatchObject({ state: "finished", status: "completed" });
  });
});

describe("runMatches upcoming", () => {
  it("lists today's remaining and tomorrow's matches with bookmaker odds", async () => {
    const h = upHarness({
      tours: ["CHALLENGER", "ITF_MEN", "ATP_DOUBLES"],
      includeBookmakerOdds: true,
    });
    const stats = await h.run;
    expect(h.requested.filter((u) => u.includes("/matches/"))).toEqual([
      upcomingUrl("men", "2026-11-25"),
      upcomingUrl("men", "2026-11-25", "doubles"),
      upcomingUrl("men", "2026-11-26"),
      upcomingUrl("men", "2026-11-26", "doubles"),
    ]);
    expect(stats.skippedStarted).toBe(4);
    expect(h.out.every((m) => m.status === "scheduled")).toBe(true);
    expect(new Set(h.out.map((m) => m.matchId)).size).toBe(h.out.length);
    expect(h.out.length).toBe(6 + 28 + 4);
    const m = h.out.find((x) => x.matchId === "3388457")!;
    expect(Object.keys(m)[0]).toBe("matchId");
    expect(m).toMatchObject({
      scheduledDate: "2026-11-26",
      startTime: "14:00",
      timeZone: "GMT+1",
      tour: "CHALLENGER",
      round: "R16",
      surface: "clay",
      player1: { name: "Nijboer Ryan", rank: 386 },
      player2: { name: "Roncadelli Franco", seed: "6" },
      seed2: "6",
      oddsHome: 3.09,
      oddsAway: 1.32,
    });
    expect(m.bookmakers!.length).toBeGreaterThanOrEqual(10);
    expect(m.bookmakers![0]).toEqual({
      name: expect.any(String),
      home: expect.any(Number),
      away: expect.any(Number),
      openingHome: expect.any(Number),
      openingAway: expect.any(Number),
    });
    const d = h.out.find((x) => x.matchId === "3388857")!;
    expect(d).toMatchObject({
      tour: "ATP_DOUBLES",
      player1: null,
      round: "QF",
      team1: [{ name: "Delaney Jake" }, { name: "Delaney Jesse" }],
    });
    // Failed detail pages leave bookmakers empty (and not charged extra).
    expect(stats.withBookmakerOdds).toBe(2);
    expect(h.out.every((x) => Array.isArray(x.bookmakers))).toBe(true);
  });

  it("round and surface from the tournament page without detail pages", async () => {
    const h = upHarness({ tours: ["CHALLENGER"] });
    await h.run;
    expect(h.requested).toContain(FLORIANOPOLIS);
    expect(h.requested.some((u) => u.includes("match-detail"))).toBe(false);
    const m = h.out.find((x) => x.matchId === "3388477")!;
    expect(m).toMatchObject({ round: "R16", surface: "clay" });
    expect(m).not.toHaveProperty("bookmakers");
  });

  it("onlyNew re-emits a match only when its odds change", async () => {
    const oddsSeen = new OddsSeen(undefined);
    const raw = { tours: ["CHALLENGER"], includeRoundAndSurface: false };
    const a = upHarness(raw, { oddsSeen });
    await a.run;
    expect(a.out.length).toBeGreaterThan(3);

    const reloaded = new OddsSeen(JSON.parse(JSON.stringify(oddsSeen)));
    const b = upHarness(raw, { oddsSeen: reloaded });
    const sb = await b.run;
    expect(b.out.length).toBe(0);
    expect(sb.skippedSeen).toBe(a.out.length);

    // Nijboer vs Roncadelli drifts from 3.09/1.32 to 3.25/1.30.
    const tomorrow = UP_PAGES[upcomingUrl("men", "2026-11-26")]!;
    const moved = tomorrow
      .replace('rowspan="2">3.09<', 'rowspan="2">3.25<')
      .replace('rowspan="2">1.32<', 'rowspan="2">1.30<');
    expect(moved).not.toBe(tomorrow);
    const c = upHarness(raw, {
      oddsSeen: reloaded,
      pages: { ...UP_PAGES, [upcomingUrl("men", "2026-11-26")]: moved },
    });
    const sc = await c.run;
    expect(c.out.map((m) => m.matchId)).toEqual(["3388457"]);
    expect(c.out[0]).toMatchObject({ oddsHome: 3.25, oddsAway: 1.3 });
    expect(sc.skippedSeen).toBe(a.out.length - 1);
  });
});

describe("state", () => {
  it("oddsHash ignores bookmaker order and opening odds, not prices", () => {
    const base = {
      oddsHome: 1.5,
      oddsAway: 2.5,
      bookmakers: [
        { name: "A", home: 1.5, away: 2.5, openingHome: 1.4, openingAway: 2.6 },
        {
          name: "B",
          home: 1.55,
          away: 2.4,
          openingHome: 1.55,
          openingAway: 2.4,
        },
      ],
    } as UpcomingMatch;
    const h = oddsHash(base);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(
      oddsHash({
        ...base,
        bookmakers: [
          { ...base.bookmakers![1]!, openingHome: 9 },
          base.bookmakers![0]!,
        ],
      }),
    ).toBe(h);
    expect(oddsHash({ ...base, oddsHome: 1.51 })).not.toBe(h);
    expect(
      oddsHash({
        ...base,
        bookmakers: [
          base.bookmakers![0]!,
          { ...base.bookmakers![1]!, away: 2.45 },
        ],
      }),
    ).not.toBe(h);
  });

  it("OddsSeen tolerates garbage and prunes old matches", () => {
    expect(new OddsSeen("x").size).toBe(0);
    const s = new OddsSeen({
      odds: {
        a: ["h1", "2026-11-26"],
        b: "bad",
        c: ["h3", "2026-09-01"],
      },
    });
    expect(s.size).toBe(2);
    expect(s.unchanged("a", "h1")).toBe(true);
    expect(s.unchanged("a", "h2")).toBe(false);
    expect(s.unchanged("z", "h1")).toBe(false);
    expect(s.toJSON()).toEqual({
      version: 1,
      odds: { a: ["h1", "2026-11-26"] },
    });
  });

  it("stateKey is stable and input-specific", () => {
    const a = stateKey({ tours: ["ATP"], playerSlugs: [] });
    expect(a).toMatch(/^STATE-[0-9a-f]{16}$/);
    expect(stateKey({ playerSlugs: [], tours: ["ATP"] })).toBe(a);
    expect(stateKey({ tours: ["WTA"], playerSlugs: [] })).not.toBe(a);
  });

  it("Seen tolerates garbage and prunes old IDs", () => {
    expect(new Seen("x").size).toBe(0);
    const s = new Seen({ seen: { a: "2026-09-28", b: 5, c: "2020-01-01" } });
    expect(s.size).toBe(2);
    expect(s.toJSON()).toEqual({ version: 1, seen: { a: "2026-09-28" } });
  });
});
