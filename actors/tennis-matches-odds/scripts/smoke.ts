/**
 * Live smoke test against TennisExplorer.
 * 1. Runs the input-schema default input (what Apify's daily test runs) and
 *    checks it finishes well under 60 s with valid matches.
 * 2. Checks per-bookmaker odds, challengers, player mode and a past date.
 * Usage: npm run smoke -w actors/tennis-matches-odds
 */
import { readFileSync } from "node:fs";
import { HttpClient } from "../src/http.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import type { Match } from "../src/match.js";
import { runMatches } from "../src/run.js";

const schema = JSON.parse(
  readFileSync(new URL("../.actor/input_schema.json", import.meta.url), "utf8"),
) as { properties: Record<string, { default?: unknown; prefill?: unknown }> };
const defaults = Object.fromEntries(
  Object.entries(schema.properties)
    .filter(([, p]) => p.prefill !== undefined || p.default !== undefined)
    .map(([k, p]) => [k, p.prefill ?? p.default]),
) as RawInput;

const problems: string[] = [];
const http = new HttpClient({ log: console.warn });

async function run(name: string, raw: RawInput) {
  const out: Match[] = [];
  const started = Date.now();
  const before = http.requests;
  const stats = await runMatches(normalizeInput(raw), {
    fetchPage: (u) => http.get(u),
    warn: (m) => console.warn(`${name}: ${m}`),
    emit: async (m) => (out.push(m), true),
  });
  const seconds = (Date.now() - started) / 1000;
  console.log(
    `\n== ${name}: ${out.length} matches, ${http.requests - before} requests, ${seconds}s`,
  );
  console.log(JSON.stringify({ ...stats, errors: stats.errors.slice(0, 3) }));
  if (stats.pagesFailed) problems.push(`${name}: ${stats.pagesFailed} failed`);
  for (const m of out) {
    if (
      !/^\d+$/.test(m.matchId) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(m.date) ||
      !m.player1.name ||
      !m.player2.name ||
      !m.tournament ||
      !m.url.startsWith("https://www.tennisexplorer.com/match-detail/")
    )
      problems.push(`${name}: bad match ${JSON.stringify(m)}`);
  }
  if (new Set(out.map((m) => m.matchId)).size !== out.length)
    problems.push(`${name}: duplicate matches`);
  return { out, stats, seconds };
}

const share = (out: Match[], f: (m: Match) => unknown) =>
  out.length ? out.filter(f).length / out.length : 0;

// 1. Default input (yesterday, ATP + WTA).
console.log("Default input:", JSON.stringify(defaults));
const d = await run("default", defaults);
console.log(JSON.stringify(d.out.slice(0, 1), null, 2));
if (!d.out.length && !d.stats.emptyDays.length)
  problems.push("default: no matches");
if (d.seconds > 45) problems.push(`default: took ${d.seconds}s`);
if (share(d.out, (m) => m.oddsHome && m.oddsAway) < 0.5)
  problems.push("default: <50% of matches have odds");
if (share(d.out, (m) => m.surface) < 0.8)
  problems.push("default: <80% have surface");
if (share(d.out, (m) => m.round) < 0.7)
  problems.push("default: <70% have round");
if (share(d.out, (m) => m.winner) < 0.95)
  problems.push("default: <95% have a winner");

// 2. Bookmaker odds on a fixed past day.
const b = await run("bookmaker-odds", {
  startDate: "2026-09-28",
  endDate: "2026-09-28",
  tours: ["ATP"],
  includeBookmakerOdds: true,
  maxMatches: 3,
});
console.log(JSON.stringify(b.out[0], null, 2).slice(0, 1500));
if (b.out.length !== 3) problems.push("bookmaker-odds: expected 3 matches");
if (!b.out.every((m) => (m.bookmakerOdds?.length ?? 0) >= 3))
  problems.push("bookmaker-odds: missing bookmaker odds");
if (!b.out.every((m) => m.player1.rank && m.round && m.surface))
  problems.push("bookmaker-odds: missing rank/round/surface");

// 3. Challenger + ITF on an older date, without enrichment.
const c = await run("challenger-itf-2025", {
  startDate: "2025-06-10",
  endDate: "2025-06-10",
  tours: ["CHALLENGER", "ITF_WOMEN"],
  includeRoundAndSurface: false,
  maxMatches: 200,
});
for (const t of ["CHALLENGER", "ITF_WOMEN"])
  if (!c.out.some((m) => m.tour === t))
    problems.push(`challenger-itf-2025: no ${t}`);
if (c.stats.pagesOk !== 2)
  problems.push("challenger-itf-2025: expected 2 pages");

// 4. Player mode.
const p = await run("player", {
  playerSlugs: ["hurkacz"],
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  tours: ["ATP", "CHALLENGER", "OTHER_MEN"],
  maxMatches: 100,
});
if (p.out.length < 10) problems.push(`player: only ${p.out.length} matches`);
if (!p.out.every((m) => m.date.startsWith("2025-")))
  problems.push("player: out-of-range dates");
if (share(p.out, (m) => m.surface && m.round) < 0.8)
  problems.push("player: missing round/surface");

console.log(`\n${http.requests} requests total`);
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
