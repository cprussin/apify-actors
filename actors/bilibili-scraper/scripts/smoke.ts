/**
 * Live smoke test against Bilibili's web API.
 * 1. Runs the input-schema default input (what Apify's daily test runs) and
 *    checks it finishes well under 60 s with complete videos and comments.
 * 2. Checks search (with pagination), specific videos, and channels by UID
 *    and by name.
 * Usage: npm run smoke -w actors/bilibili-scraper
 */
import { readFileSync } from "node:fs";
import { BiliClient } from "../src/bili.js";
import { HttpClient } from "../src/http.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import type { Video } from "../src/parse.js";
import { runScrape } from "../src/run.js";
import { BiliSource } from "../src/source.js";

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
const client = new BiliClient(http, { log: console.warn });
const source = new BiliSource(client, console.warn);

async function run(name: string, raw: RawInput) {
  const out: Video[] = [];
  const started = Date.now();
  const stats = await runScrape(normalizeInput(raw), {
    source,
    log: (m) => problems.push(`${name}: ${m}`),
    emit: async (v) => (out.push(v), true),
  });
  const seconds = (Date.now() - started) / 1000;
  const comments = out.reduce((n, v) => n + (v.comments?.length ?? 0), 0);
  console.log(
    `\n== ${name}: ${out.length} videos, ${comments} comments in ${seconds}s`,
  );
  console.log(JSON.stringify(stats.groups));
  for (const v of out) {
    if (
      !/^BV1\w{9}$/.test(v.bvid) ||
      !v.aid ||
      !v.title ||
      !v.author.mid ||
      !v.author.name ||
      Number.isNaN(Date.parse(v.publishDate)) ||
      !v.cover.startsWith("https://") ||
      !(v.views > 0) ||
      !(v.durationSec > 0)
    )
      problems.push(`${name}: bad video ${JSON.stringify(v).slice(0, 500)}`);
    for (const c of v.comments ?? [])
      if (!c.rpid || !c.author.mid || Number.isNaN(Date.parse(c.date)))
        problems.push(`${name}: bad comment ${JSON.stringify(c)}`);
  }
  if (new Set(out.map((v) => v.bvid)).size !== out.length)
    problems.push(`${name}: duplicate videos`);
  return { out, stats, seconds, comments };
}

// 1. Default input.
console.log("Default input:", JSON.stringify(defaults));
const d = await run("default", defaults);
console.log(JSON.stringify(d.out[0], null, 2).slice(0, 3000));
if (d.out.length !== Number(defaults.maxItems))
  problems.push(`default: ${d.out.length}/${defaults.maxItems} videos`);
if (d.out.filter((v) => v.comments?.length).length < d.out.length * 0.8)
  problems.push("default: most videos have no comments");
if (!d.out.some((v) => v.tags.length)) problems.push("default: no tags");
if (!d.out.every((v) => v.category)) problems.push("default: missing category");
if (d.seconds > 40) problems.push(`default: took ${d.seconds}s`);

// 2. Search across more than one page, ordered by views.
const s = await run("search", {
  mode: "search",
  keywords: ["minecraft"],
  searchOrder: "views",
  maxItems: 25,
  includeComments: false,
});
if (s.out.length !== 25) problems.push(`search: ${s.out.length}/25`);

// 3. Specific videos, including a missing one.
const v = await run("videos", {
  mode: "videos",
  videos: [
    "https://www.bilibili.com/video/BV1xx411c7mD",
    "av170001",
    "BV1xx411c7m1",
  ],
  maxCommentsPerVideo: 100,
});
if (v.out.length !== 2) problems.push(`videos: ${v.out.length}/2`);
console.log(
  "comments per video (guest cap):",
  v.out.map((x) => x.comments?.length),
);
problems.splice(
  0,
  problems.length,
  ...problems.filter((m) => !/^videos: videos: BV1xx411c7m1 not found/.test(m)),
);

// 4. Channels by UID and by name.
const u = await run("user", {
  mode: "user",
  userIds: ["https://space.bilibili.com/546195", "影视飓风"],
  maxItems: 35,
  includeComments: false,
});
if (u.stats.groups["user:546195"]?.emitted !== 35)
  problems.push("user: expected 35 videos by UID");
const own = u.out.slice(0, 35).filter((x) => x.author.mid === "546195");
// Joint uploads (联合投稿) list another member as owner.
if (own.length < 30) problems.push(`user: only ${own.length}/35 by UID 546195`);

console.log(
  `\n${http.requests} requests, ${client.sessions} sessions, ${client.riskHits} risk-control hits`,
);
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
