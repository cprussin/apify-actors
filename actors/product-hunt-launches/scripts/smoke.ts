/**
 * Live smoke test against Product Hunt.
 * 1. Runs the input-schema default input (what Apify's daily test runs) and
 *    checks it finishes well under 60 s with valid launches.
 * 2. Checks topics, keyword filter, token-free leaderboard, and (only when
 *    PRODUCT_HUNT_TOKEN is set) the official API.
 * Usage: npm run smoke -w actors/product-hunt-launches
 */
import { readFileSync } from "node:fs";
import { ApiSource } from "../src/api.js";
import { FeedSource } from "../src/feed.js";
import { HttpClient } from "../src/http.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import type { Launch } from "../src/launch.js";
import { runLaunches } from "../src/run.js";
import { WebsiteResolver } from "../src/website.js";

const schema = JSON.parse(
  readFileSync(new URL("../.actor/input_schema.json", import.meta.url), "utf8"),
) as { properties: Record<string, { default?: unknown }> };
// Apify's daily test runs with the schema defaults only (not prefills).
const defaults = Object.fromEntries(
  Object.entries(schema.properties)
    .filter(([, p]) => p.default !== undefined)
    .map(([k, p]) => [k, p.default]),
) as RawInput;

const problems: string[] = [];
const http = new HttpClient({ log: console.warn });
const feed = new FeedSource(http, console.warn);
const websites = new WebsiteResolver(http, console.warn);
const token = process.env.PRODUCT_HUNT_TOKEN;

async function run(name: string, raw: RawInput) {
  const out: Launch[] = [];
  const started = Date.now();
  const input = normalizeInput(raw);
  const stats = await runLaunches(input, {
    feed,
    websites,
    api: input.apiToken
      ? new ApiSource(new HttpClient({ log: console.warn }), {
          token: input.apiToken,
          includeMakers: input.includeMakers,
          log: console.warn,
        })
      : undefined,
    log: (m) => console.warn(`${name}: ${m}`),
    emit: async (l) => (out.push(l), true),
  });
  const seconds = (Date.now() - started) / 1000;
  console.log(`\n== ${name}: ${out.length} launches in ${seconds}s`);
  console.log(JSON.stringify(stats));
  for (const l of out) {
    if (
      !/^\d+$/.test(l.id) ||
      !l.name ||
      !l.url.startsWith("https://www.producthunt.com/") ||
      (l.votesCount !== null && !(l.votesCount >= 0))
    )
      problems.push(`${name}: bad launch ${JSON.stringify(l)}`);
  }
  if (new Set(out.map((l) => l.id)).size !== out.length)
    problems.push(`${name}: duplicate launches`);
  return { out, stats, seconds };
}

// 1. Default input.
console.log("Default input:", JSON.stringify(defaults));
const d = await run("default", defaults);
console.log(JSON.stringify(d.out.slice(0, 2), null, 2));
if (d.out.length !== Number(defaults.maxItems))
  problems.push(`default: ${d.out.length}/${defaults.maxItems} launches`);
if (d.out.filter((l) => l.votesCount !== null).length < d.out.length * 0.8)
  problems.push("default: most launches have no vote count");
if (!d.out.every((l) => l.tagline)) problems.push("default: missing taglines");
if (d.seconds > 30) problems.push(`default: took ${d.seconds}s`);

// 2. Topics (incl. an unknown one), keywords, token-free leaderboard.
const t = await run("topics", {
  mode: "topics",
  topics: [
    "developer-tools",
    "https://www.producthunt.com/topics/zzz-not-a-topic",
  ],
  maxItems: 30,
  maxPerGroup: 15,
});
if (t.out.length !== 15) problems.push(`topics: ${t.out.length}/15`);
if (t.stats.groups["topic:zzz-not-a-topic"]?.status !== "notFound")
  problems.push("topics: unknown topic not detected");
if (!t.out.every((l) => l.topics.includes("developer-tools")))
  problems.push("topics: topic missing on items");

const k = await run("keywords", {
  mode: "latest",
  searchKeywords: "ai, app, the",
  maxItems: 50,
});
if (!k.out.length) problems.push("keywords: no results");

const lb = await run("leaderboard-no-token", {
  mode: "leaderboard",
  maxItems: 10,
});
const votes = lb.out.map((l) => l.votesCount ?? -1);
if (votes.some((v, i) => i > 0 && v > votes[i - 1]!))
  problems.push("leaderboard-no-token: not sorted by votes");
if (!lb.out.some((l) => l.dailyRank === 1))
  console.warn("leaderboard-no-token: no #1 of the day in feed (warning)");

// 3. Official API (optional).
if (token) {
  const a = await run("api-leaderboard", {
    mode: "leaderboard",
    startDate: "2026-09-01",
    endDate: "2026-09-02",
    maxPerGroup: 5,
    includeComments: true,
    maxCommentsPerLaunch: 3,
    apiToken: token,
  });
  if (a.out.length !== 10) problems.push(`api: ${a.out.length}/10`);
  if (!a.out.every((l) => l.dailyRank && l.launchDate && l.topics.length))
    problems.push("api: missing rank/date/topics");
} else {
  console.log("\nPRODUCT_HUNT_TOKEN not set; skipping API checks.");
}

console.log(
  `\n${http.requests} requests total; websites resolved: ${websites.resolved}, blocked: ${websites.blocked}`,
);
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
