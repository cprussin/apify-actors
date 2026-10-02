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
import type { Match } from "../src/match.js";
import { playerUrl, resultsUrl, runMatches } from "../src/run.js";
import { Seen, stateKey } from "../src/state.js";

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
      out.push(m);
      return opts.budget === undefined || out.length < opts.budget;
    },
    warn: (m) => warnings.push(m),
    seen: opts.seen,
  });
  return { run, out, requested, warnings };
}

describe("input", () => {
  it("defaults to yesterday, ATP + WTA", () => {
    expect(normalizeInput({}, NOW)).toEqual({
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

describe("state", () => {
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
