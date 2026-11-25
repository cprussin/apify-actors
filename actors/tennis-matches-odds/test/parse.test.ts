import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyTour, summarize } from "../src/match.js";
import {
  LayoutError,
  applyDetail,
  applyUpcomingDetail,
  normalizeRound,
  parseMatchDetail,
  parsePlayerPage,
  parseResultsPage,
  parseScoreHtml,
  parseTournamentPage,
  parseUpcomingPage,
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

describe("parseResultsPage (doubles)", () => {
  const page = parseResultsPage(
    fx("results-atp-double-2026-11-24.html"),
    "2026-11-24",
    "men",
    "doubles",
  );

  it("parses teams, scores and odds", () => {
    expect(page.matches.length).toBe(3);
    expect(page.matches.every((m) => m.tour === "ATP_DOUBLES")).toBe(true);
    const m = page.matches.find((x) => x.matchId === "3386434")!;
    expect(m).toMatchObject({
      tournament: "Playford 2 challenger",
      player1: { name: "Falck R. / Suarez B.", slug: null },
      player2: { name: "Santillan A. / Zheng B." },
      team1: [
        { name: "Falck R.", slug: "falck" },
        { name: "Suarez B.", slug: "suarez-e2086" },
      ],
      team2: [
        { name: "Santillan A.", slug: "santillan-29bed" },
        { name: "Zheng B.", slug: "zheng-642ed" },
      ],
      winner: "player1",
      winnerName: "Falck R. / Suarez B.",
      score: "2-6 6-4 10-6",
      status: "completed",
      state: "finished",
      oddsHome: 1.96,
      oddsAway: 1.7,
    });
  });

  it("singles rows keep team1/team2 null", () => {
    const s = parseResultsPage(
      fx("results-atp-2026-09-28.html"),
      "2026-09-28",
      "men",
    );
    expect(s.matches[0]).toMatchObject({
      team1: null,
      team2: null,
      state: "finished",
    });
  });
});

describe("parseUpcomingPage", () => {
  const page = parseUpcomingPage(
    fx("matches-atp-2026-11-26.html"),
    "2026-11-26",
    "men",
  );

  it("lists scheduled matches with pre-match odds and start times", () => {
    expect(page).toMatchObject({ started: 0, noMatches: false });
    expect(page.matches.length).toBe(28);
    expect(page.matches[0]).toEqual({
      matchId: "3388457",
      scheduledDate: "2026-11-26",
      startTime: "14:00",
      timeZone: "GMT+1",
      tournament: "Florianopolis challenger",
      tournamentUrl:
        "https://www.tennisexplorer.com/florianopolis-challenger/2026/atp-men/",
      tournamentCountry: "BR",
      tour: "CHALLENGER",
      surface: null,
      round: null,
      status: "scheduled",
      state: "scheduled",
      player1: {
        name: "Nijboer R.",
        slug: "nijboer",
        country: null,
        seed: null,
        rank: null,
      },
      player2: {
        name: "Roncadelli F.",
        slug: "roncadelli",
        country: null,
        seed: "6",
        rank: null,
      },
      team1: null,
      team2: null,
      seed1: null,
      seed2: "6",
      oddsHome: 3.09,
      oddsAway: 1.32,
      sourceUrl: "https://www.tennisexplorer.com/match-detail/?id=3388457",
    });
  });

  it("handles unset times, missing odds and Futures without a page", () => {
    const tbd = page.matches.find((m) => m.matchId === "3388915")!;
    expect(tbd).toMatchObject({
      startTime: null,
      tour: "ITF_MEN",
      tournamentUrl: null,
      oddsHome: null,
      oddsAway: null,
    });
    expect(page.matches.filter((m) => m.oddsHome !== null).length).toBe(11);
  });

  it("today: skips live/finished matches and yesterday's box", () => {
    const t = parseUpcomingPage(
      fx("matches-atp-2026-11-25-today.html"),
      "2026-11-25",
      "men",
    );
    expect(t.started).toBe(4);
    expect(t.matches.map((m) => m.matchId)).toEqual([
      "3386144",
      "3386146",
      "3386142",
      "3388196",
      "3388198",
      "3386150",
    ]);
    expect(
      t.matches.every((m) => m.tournament === "Florianopolis challenger"),
    ).toBe(true);
  });

  it("parses doubles teams and team seeds", () => {
    const d = parseUpcomingPage(
      fx("matches-atp-double-2026-11-26.html"),
      "2026-11-26",
      "men",
      "doubles",
    );
    expect(d.matches.length).toBe(4);
    expect(d.matches[0]).toMatchObject({
      matchId: "3388857",
      tour: "ATP_DOUBLES",
      player1: null,
      player2: null,
      team1: [
        { name: "Delaney J.", slug: "delaney" },
        { name: "Delaney J.", slug: "delaney-da784" },
      ],
      team2: [
        { name: "Falck R.", slug: "falck" },
        { name: "Suarez B.", slug: "suarez-e2086" },
      ],
      seed1: "3",
      seed2: null,
      oddsHome: 1.86,
      oddsAway: 1.65,
    });
  });

  it("empty day and unrelated pages", () => {
    expect(
      parseUpcomingPage(fx("results-empty.html"), "2026-12-25", "men"),
    ).toEqual({ matches: [], started: 0, noMatches: true });
    expect(() =>
      parseUpcomingPage("<html>blocked</html>", "2026-11-26", "men"),
    ).toThrow(LayoutError);
  });
});

describe("upcoming match detail", () => {
  it("singles: pre-match bookmaker odds, round, surface, ranks", () => {
    const m = parseUpcomingPage(
      fx("matches-atp-2026-11-26.html"),
      "2026-11-26",
      "men",
    ).matches[0]!;
    const d = parseMatchDetail(fx("match-detail-3388457.html"));
    expect(d.teams).toBeNull();
    const a = applyUpcomingDetail(m, d, true);
    expect(a).toMatchObject({
      round: "R16",
      surface: "clay",
      player1: { name: "Nijboer Ryan", rank: 386 },
      player2: { name: "Roncadelli Franco", rank: 210, seed: "6" },
    });
    expect(a.bookmakers!.length).toBe(d.bookmakerOdds.length);
    expect(a.bookmakers!.length).toBeGreaterThanOrEqual(10);
    for (const b of a.bookmakers!) {
      expect(b.home).toBeGreaterThan(1);
      expect(b.openingHome).toBeGreaterThan(1);
    }
    // Reversed listing: odds follow the players.
    const r = applyUpcomingDetail(
      { ...m, player1: m.player2, player2: m.player1 },
      d,
      true,
    );
    expect(r.player1!.name).toBe("Roncadelli Franco");
    expect(r.bookmakers![0]!.home).toBe(a.bookmakers![0]!.away);
    expect(r.bookmakers![0]!.openingAway).toBe(a.bookmakers![0]!.openingHome);
  });

  it("doubles: both teams with full names and doubles ranks", () => {
    const d = parseMatchDetail(fx("match-detail-3388857.html"));
    expect(d).toMatchObject({ round: "QF", surface: "hard", time: "03:00" });
    expect(d.teams![0].map((p) => p.slug)).toEqual([
      "delaney",
      "delaney-da784",
    ]);
    expect(d.teams![1].map((p) => p.rank)).toEqual([335, 231]);
    const m = parseUpcomingPage(
      fx("matches-atp-double-2026-11-26.html"),
      "2026-11-26",
      "men",
      "doubles",
    ).matches[0]!;
    const a = applyUpcomingDetail(m, d, true);
    expect(a.team2).toEqual([
      {
        name: "Falck Reece",
        slug: "falck",
        country: null,
        seed: null,
        rank: 335,
      },
      {
        name: "Suarez Billy",
        slug: "suarez-e2086",
        country: null,
        seed: null,
        rank: 231,
      },
    ]);
    expect(a.bookmakers![0]).toEqual({
      name: "bet-at-home",
      home: 1.95,
      away: 1.75,
      openingHome: 1.9,
      openingAway: 1.8,
    });
    const swapped = applyUpcomingDetail(
      { ...m, team1: m.team2, team2: m.team1 },
      d,
      true,
    );
    expect(swapped.team1![0]!.name).toBe("Falck Reece");
    expect(swapped.bookmakers![0]!.home).toBe(1.75);
  });
});

describe("parseTournamentPage", () => {
  it("reads surface and rounds by match ID", () => {
    const t = parseTournamentPage(fx("tournament-porto-challenger-2026.html"));
    expect(t.surface).toBe("hard");
    expect(t.rounds["3333630"]).toBe("1R");
    expect(Object.keys(t.rounds).length).toBeGreaterThanOrEqual(10);
  });

  it("reads rounds of scheduled matches", () => {
    const t = parseTournamentPage(
      fx("tournament-florianopolis-challenger-2026.html"),
    );
    expect(t.surface).toBe("clay");
    expect(t.rounds["3388457"]).toBe("R16");
    expect(t.rounds["3388194"]).toBe("1R");
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
