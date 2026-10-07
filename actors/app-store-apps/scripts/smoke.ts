/**
 * Live smoke test against the App Store and Google Play.
 * 1. Runs the input-schema prefill input (what Apify's daily test runs) and
 *    checks it finishes well under 60 s with valid rank rows.
 * 2. Checks charts on both stores, app details on both stores and rank
 *    changes mode.
 * Usage: npm run smoke -w actors/app-store-apps
 */
import { readFileSync } from "node:fs";
import type { Row } from "../src/app.js";
import { AppleClient } from "../src/apple.js";
import { GoogleClient } from "../src/google.js";
import { HttpClient } from "../src/http.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import { RankTracker } from "../src/ranks.js";
import { runApps, type ChargeEvent } from "../src/run.js";

const schema = JSON.parse(
  readFileSync(new URL("../.actor/input_schema.json", import.meta.url), "utf8"),
) as { properties: Record<string, { default?: unknown; prefill?: unknown }> };
const prefill = Object.fromEntries(
  Object.entries(schema.properties)
    .filter(([, p]) => p.prefill !== undefined || p.default !== undefined)
    .map(([k, p]) => [k, p.prefill ?? p.default]),
) as RawInput;

const problems: string[] = [];
const http = new HttpClient({ log: console.warn });
const apple = new AppleClient(http, console.warn);
const google = new GoogleClient(http);

async function run(name: string, raw: RawInput, tracker?: RankTracker) {
  const out: { row: Row; event: ChargeEvent | null }[] = [];
  const started = Date.now();
  const stats = await runApps(normalizeInput(raw), {
    apple,
    google,
    tracker,
    log: (m) => {
      if (!m.includes("nonexistent")) problems.push(`${name}: ${m}`);
    },
    emit: async (row, event) => (out.push({ row, event }), true),
  });
  const seconds = (Date.now() - started) / 1000;
  console.log(`\n== ${name}: ${out.length} rows in ${seconds}s`);
  console.log(JSON.stringify(stats));
  for (const { row } of out.slice(0, 3))
    console.log(
      `  ${row.type} ${row.store} #${row.rank} ${row.name} (${row.appId}) ${row.rating ?? ""} ${row.price ?? ""} ${row.changeType ?? ""}`,
    );
  for (const { row } of out) {
    if (row.type === "error") continue;
    if (
      !row.appId ||
      !row.name ||
      !row.url?.startsWith("https://") ||
      (row.type !== "app" && row.changeType !== "dropped" && !row.rank)
    )
      problems.push(`${name}: bad row ${JSON.stringify(row).slice(0, 300)}`);
  }
  return { out, stats, seconds };
}

// 1. Prefill input.
console.log("Prefill input:", JSON.stringify(prefill));
const def = await run("prefill", prefill);
if (def.seconds > 45) problems.push(`prefill: took ${def.seconds}s`);
if (def.out.length !== 10) problems.push(`prefill: ${def.out.length} rows`);

// 2. Charts, both stores.
const charts = await run("charts", {
  mode: "topCharts",
  charts: ["topFree", "topGrossing"],
  category: "games",
  maxResults: 5,
});
if (charts.out.filter((o) => o.row.type === "chartRank").length !== 20)
  problems.push("charts: expected 20 rows");
const gb = await run("charts gb paid", {
  mode: "topCharts",
  charts: ["topPaid"],
  country: "gb",
  maxResults: 3,
});
if (gb.out.some((o) => o.row.free !== false && o.row.store === "apple"))
  problems.push("charts gb paid: free app in the paid chart");

// 3. Details, both stores, plus a missing app.
const details = await run("details", {
  mode: "appDetails",
  apps: [
    "https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580",
    "apple:com.burbn.instagram",
    "com.spotify.music",
    "com.mojang.minecraftpe",
    "com.nonexistent.zzzqqq",
  ],
});
const errs = details.out.filter((o) => o.row.type === "error");
if (errs.length !== 1) problems.push(`details: ${errs.length} errors`);
const mc = details.out.find((o) => o.row.appId === "com.mojang.minecraftpe");
if (!mc || !(mc.row.price! > 0) || !mc.row.version)
  problems.push("details: Minecraft price/version missing");

// 4. Rank changes: same query twice; the second run should be mostly unchanged.
const tracker = new RankTracker();
const kw = {
  keywords: ["budget tracker"],
  maxResults: 25,
  rankChangesOnly: true,
  minRankChange: 3,
};
const first = await run("ranks 1", kw, tracker);
if (!first.out.every((o) => o.row.changeType === "baseline"))
  problems.push("ranks 1: not all baseline");
const second = await run("ranks 2", kw, tracker);
if (second.stats.unchanged < 15)
  problems.push(`ranks 2: only ${second.stats.unchanged} unchanged`);

console.log(`\n${http.requests} requests.`);
if (problems.length) {
  console.error(`\nPROBLEMS:\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("\nOK");
