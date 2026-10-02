import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyTour, summarize } from "../src/match.js";
import {
  LayoutError,
  applyDetail,
  normalizeRound,
  parseMatchDetail,
  parsePlayerPage,
  parseResultsPage,
  parseScoreHtml,
  parseTournamentPage,
} from "../src/parse.js";

const fx = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("parseResultsPage", () => {
  const page = parseResultsPage(
    fx("results-atp-2026-09-28.html"),
    "2026-09-28",
    "men",
  );

  it("parses every match once", () => {
    expect(page.noMatches).toBe(false);
    expect(page.matches.length).toBe(265);
    expect(new Set(page.matches.map((m) => m.matchId)).size).toBe(265);
  });

  it("parses players, scores, tiebreaks, closing odds and tournament", () => {
    const m = page.matches.find((x) => x.matchId === "3334240")!;
    expect(m).toMatchObject({
      date: "2026-09-28",
      time: "13:25",
      tournament: "Chengdu",
      tournamentUrl: "https://www.tennisexplorer.com/chengdu/2026/atp-men/",
      tournamentCountry: "CN",
      tour: "ATP",
      player1: { name: "Hurkacz H.", slug: "hurkacz", seed: "5" },
      player2: { name: "Shapovalov D.", slug: "shapovalov", seed: "7" },
      winner: "player1",
      winnerName: "Hurkacz H.",
      setsPlayer1: 2,
      setsPlayer2: 1,
      setScores: [
        { player1: 6, player2: 7, tiebreak: 8 },
        { player1: 6, player2: 3, tiebreak: null },
        { player1: 6, player2: 3, tiebreak: null },
      ],
      score: "6-7(8) 6-3 6-3",
      status: "completed",
      oddsHome: 1.61,
      oddsAway: 2.29,
      url: "https://www.tennisexplorer.com/match-detail/?id=3334240",
    });
  });

  it("classifies challengers, futures and UTR events", () => {
    const tours = new Set(page.matches.map((m) => `${m.tournament}|${m.tour}`));
    expect(tours).toContain("Porto challenger|CHALLENGER");
    expect(tours).toContain("Futures 2026|ITF_MEN");
    expect(tours).toContain("UTR Pro Tennis Series 3|OTHER_MEN");
    const futures = page.matches.find((m) => m.tournament === "Futures 2026")!;
    expect(futures.tournamentUrl).toBeNull();
  });

  it("detects retirements and walkovers", () => {
    const ret = page.matches.find((m) => m.player1.name === "Arnaboldi F.")!;
    expect(ret.status).toBe("retired");
    expect(ret.winner).toBe("player1");
    const wo = page.matches.find((m) => m.player1.name === "Roddick J.")!;
    expect(wo).toMatchObject({
      status: "walkover",
      winner: "player1",
      setScores: [],
      score: "",
      time: null,
    });
  });

  it("parses the WTA page", () => {
    const w = parseResultsPage(
      fx("results-wta-2026-09-28.html"),
      "2026-09-28",
      "women",
    );
    expect(w.matches.length).toBeGreaterThan(100);
    expect(
      w.matches.every((m) => m.tour.endsWith("WOMEN") || m.tour === "WTA"),
    ).toBe(true);
    expect(w.matches.filter((m) => m.oddsHome !== null).length).toBeGreaterThan(
      50,
    );
  });

  it("recognizes a genuinely empty day", () => {
    const e = parseResultsPage(fx("results-empty.html"), "2026-12-25", "men");
    expect(e).toEqual({ matches: [], noMatches: true });
  });

  it("throws on an unrelated page", () => {
    expect(() =>
      parseResultsPage(
        "<html><body>blocked</body></html>",
        "2026-09-28",
        "men",
      ),
    ).toThrow(LayoutError);
  });
});

describe("parseTournamentPage", () => {
  it("reads surface and rounds by match ID", () => {
    const t = parseTournamentPage(fx("tournament-porto-challenger-2026.html"));
    expect(t.surface).toBe("hard");
    expect(t.rounds["3333630"]).toBe("1R");
    expect(Object.keys(t.rounds).length).toBeGreaterThanOrEqual(10);
  });
});

describe("parseMatchDetail", () => {
  const d = parseMatchDetail(fx("match-detail-3334240.html"));

  it("reads header, players and ranks", () => {
    expect(d).toMatchObject({
      date: "2026-09-28",
      time: "13:25",
      round: "SF",
      surface: "hard",
      players: [
        { slug: "hurkacz", fullName: "Hurkacz Hubert", rank: 41 },
        { slug: "shapovalov", fullName: "Shapovalov Denis", rank: 46 },
      ],
    });
  });

  it("reads per-bookmaker closing and opening odds, excluding the average", () => {
    expect(d.bookmakerOdds.length).toBe(15);
    expect(d.bookmakerOdds.map((o) => o.bookmaker)).not.toContain(
      "Average odds",
    );
    const b = d.bookmakerOdds.find((o) => o.bookmaker === "10Bet")!;
    expect(b.oddsHome).toBe(1.6);
    expect(b.oddsAway).toBe(2.25);
    expect(b.openingOddsHome).toBeGreaterThan(1);
    expect(
      d.bookmakerOdds.find((o) => o.bookmaker === "Pinnacle"),
    ).toMatchObject({
      oddsHome: 1.66,
      oddsAway: 2.37,
      openingOddsHome: 1.77,
      openingOddsAway: 2.16,
    });
  });

  it("applies detail to a match, swapping odds when players are reversed", () => {
    const m = parseResultsPage(
      fx("results-atp-2026-09-28.html"),
      "2026-09-28",
      "men",
    ).matches.find((x) => x.matchId === "3334240")!;
    const a = applyDetail(m, d, true);
    expect(a).toMatchObject({
      round: "SF",
      surface: "hard",
      player1: { name: "Hurkacz Hubert", rank: 41, seed: "5" },
      winnerName: "Hurkacz Hubert",
    });
    expect(a.bookmakerOdds![0]!.oddsHome).toBe(d.bookmakerOdds[0]!.oddsHome);
    const swapped = applyDetail(
      { ...m, player1: m.player2, player2: m.player1, winner: "player2" },
      d,
      true,
    );
    expect(swapped.player1.rank).toBe(46);
    expect(swapped.bookmakerOdds![0]!.oddsHome).toBe(
      d.bookmakerOdds[0]!.oddsAway,
    );
  });

  it("throws on an unrelated page", () => {
    expect(() => parseMatchDetail("<html></html>")).toThrow(LayoutError);
  });
});

describe("parsePlayerPage", () => {
  const p = parsePlayerPage(fx("player-hurkacz-2026.html"), 2026, "hurkacz");

  it("reads profile and singles matches of the year", () => {
    expect(p.name).toBe("Hurkacz Hubert");
    expect(p.country).toBe("Poland");
    expect(p.matches.length).toBeGreaterThan(40);
    expect(p.matches.every((m) => m.date.startsWith("2026-"))).toBe(true);
    expect(
      p.matches.every(
        (m) => m.player1.slug === "hurkacz" || m.player2.slug === "hurkacz",
      ),
    ).toBe(true);
  });

  it("parses round, surface, score and odds", () => {
    const f = p.matches.find((m) => m.matchId === "3335520")!;
    expect(f).toMatchObject({
      date: "2026-09-29",
      tournament: "Chengdu",
      tour: "ATP",
      surface: "hard",
      round: "F",
      player1: { slug: "davidovich-fokina", country: null },
      player2: { slug: "hurkacz", country: "Poland" },
      winner: "player1",
      score: "6-4 7-6(7)",
      setsPlayer1: 2,
      setsPlayer2: 0,
      oddsHome: 2.19,
      oddsAway: 1.66,
    });
  });
});

describe("helpers", () => {
  it("parseScoreHtml", () => {
    expect(parseScoreHtml("6<sup>8</sup>-7, 6-3, 7-6<sup>5</sup>")).toEqual([
      { player1: 6, player2: 7, tiebreak: 8 },
      { player1: 6, player2: 3, tiebreak: null },
      { player1: 7, player2: 6, tiebreak: 5 },
    ]);
  });

  it("normalizeRound", () => {
    expect(normalizeRound("semifinal")).toBe("SF");
    expect(normalizeRound("1. round")).toBe("1R");
    expect(normalizeRound("R16")).toBe("R16");
    expect(normalizeRound("Round")).toBeNull();
    expect(normalizeRound("Qualification - quarterfinal")).toBe("Q-QF");
  });

  it("classifyTour", () => {
    expect(classifyTour("Beijing", "women")).toBe("WTA");
    expect(classifyTour("Reims ITF", "women")).toBe("ITF_WOMEN");
    expect(classifyTour("Bari challenger", "men")).toBe("CHALLENGER");
  });

  it("summarize: retirement mid-set, completed 10-8 match tiebreak", () => {
    expect(
      summarize(
        [
          { player1: 3, player2: 6, tiebreak: null },
          { player1: 5, player2: 4, tiebreak: null },
        ],
        1,
        0,
      ),
    ).toMatchObject({ winner: "player1", status: "retired" });
    expect(
      summarize(
        [
          { player1: 6, player2: 4, tiebreak: null },
          { player1: 4, player2: 6, tiebreak: null },
          { player1: 10, player2: 8, tiebreak: null },
        ],
        2,
        1,
      ),
    ).toMatchObject({ winner: "player1", status: "completed" });
  });
});
