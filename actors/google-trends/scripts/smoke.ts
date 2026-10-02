/**
 * Live smoke test against Google Trends (no proxy).
 * 1. Runs the input-schema default input (what Apify's daily test runs) and
 *    checks it finishes well under 60 s with data for every term x dataset.
 * 2. Checks >5-term batching/normalization and Trending now.
 * Google throttles single IPs after ~15 explore calls, so this stays small.
 * Usage: npm run smoke -w actors/google-trends
 */
import { readFileSync } from "node:fs";
import { GoogleTrends } from "../src/google-trends.js";
import { TrendsClient } from "../src/http.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import {
  runTrends,
  type ResultItem,
  type TimelineRow,
  type TrendResult,
} from "../src/run.js";

const schema = JSON.parse(
  readFileSync(new URL("../.actor/input_schema.json", import.meta.url), "utf8"),
) as { properties: Record<string, { default?: unknown; prefill?: unknown }> };
const defaults = Object.fromEntries(
  Object.entries(schema.properties)
    .filter(([, p]) => p.prefill !== undefined || p.default !== undefined)
    .map(([k, p]) => [k, p.prefill ?? p.default]),
) as RawInput;

const problems: string[] = [];
const http = new TrendsClient({ log: console.warn });
const trends = new GoogleTrends(http);

async function run(name: string, raw: RawInput) {
  const out: ResultItem[] = [];
  const started = Date.now();
  const stats = await runTrends(normalizeInput(raw), {
    trends,
    log: (m) => problems.push(`${name}: ${m}`),
    emit: async (r) => (out.push(r), true),
  });
  const seconds = (Date.now() - started) / 1000;
  console.log(
    `\n== ${name}: ${out.length} items in ${seconds}s, ${http.requests} requests so far, ${http.blocks} blocks`,
  );
  console.log(JSON.stringify(stats));
  return { out, stats, seconds };
}

// 1. Default input.
console.log("Default input:", JSON.stringify(defaults));
const d = await run("default", defaults);
const items = d.out as TrendResult[];
for (const i of items) {
  console.log(
    `${i.dataset} ${i.term}: ${i.rowCount} rows, e.g. ${JSON.stringify(i.rows[0])}`,
  );
  if (!i.hasData) problems.push(`default: no data for ${i.term}/${i.dataset}`);
}
const want =
  (defaults.searchTerms?.length ?? 0) * (defaults.datasets?.length ?? 0);
if (items.length !== want)
  problems.push(`default: ${items.length}/${want} items`);
const iot = items.find((i) => i.dataset === "interestOverTime");
if (!iot || !(iot.rows as TimelineRow[]).some((r) => r.value === 100))
  problems.push("default: interest over time has no 100 peak");
if (d.seconds > 45) problems.push(`default: took ${d.seconds}s`);

// 2. More than 5 terms: two batches, anchored on "weather".
const terms = [
  "weather",
  "news",
  "youtube",
  "amazon",
  "facebook",
  "gmail",
  "netflix",
];
const b = await run("batched", {
  searchTerms: terms,
  datasets: ["interestOverTime"],
  timeframe: "today 3-m",
  geo: "",
});
const bt = b.out as TrendResult[];
if (bt.map((i) => i.term).join() !== terms.join())
  problems.push(`batched: got ${bt.map((i) => i.term)}`);
const maxNorm = Math.max(
  ...bt.flatMap((i) =>
    (i.rows as TimelineRow[]).map((r) => r.normalizedValue ?? -1),
  ),
);
if (Math.abs(maxNorm - 100) > 0.01)
  problems.push(`batched: normalized max ${maxNorm}`);
if (bt.at(-1)?.anchorTerm !== "weather") problems.push("batched: no anchor");

// 3. Trending now.
const t = await run("trending", {
  mode: "trendingNow",
  geo: "GB",
  trendingHours: "4",
  maxTrendingSearches: 10,
});
console.log(JSON.stringify(t.out.slice(0, 2), null, 2));
if (!t.out.length) problems.push("trending: no results");
for (const x of t.out)
  if (x.dataset !== "trendingNow" || !x.term || !x.startedAt)
    problems.push(`trending: bad item ${JSON.stringify(x)}`);

console.log(`\n${http.requests} requests total, ${http.blocks} rate-limited`);
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
