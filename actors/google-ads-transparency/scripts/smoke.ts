/**
 * Live smoke test against the Google Ads Transparency Center (no Apify proxy).
 * 1. Runs the input-schema default input (what Apify's daily test runs) and
 *    checks it finishes under 60 s with complete ads.
 * 2. Checks domain + format + platform filters, date filter, pagination and
 *    advertiser search mode.
 * Google rate-limits single IPs after a handful of RPC calls, so this stays
 * small. Honors HTTPS_PROXY (for sandboxed dev environments).
 * Usage: npm run smoke -w actors/google-ads-transparency
 */
import { readFileSync } from "node:fs";
import { RpcClient } from "../src/http.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import { runScraper, type Ad, type AdvertiserResult } from "../src/run.js";
import { tlsFetch } from "../src/tls-fetch.js";
import { Transparency } from "../src/transparency.js";

const schema = JSON.parse(
  readFileSync(new URL("../.actor/input_schema.json", import.meta.url), "utf8"),
) as { properties: Record<string, { default?: unknown; prefill?: unknown }> };
const defaults = Object.fromEntries(
  Object.entries(schema.properties)
    .filter(([, p]) => p.prefill !== undefined || p.default !== undefined)
    .map(([k, p]) => [k, p.prefill ?? p.default]),
) as RawInput;

const problems: string[] = [];
const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const client = new RpcClient({
  fetch: tlsFetch(async () => envProxy),
  baseDelayMs: 15_000,
  maxDelayMs: 90_000,
  maxRetries: 6,
  log: console.warn,
});
const api = new Transparency(client);

async function run(name: string, raw: RawInput) {
  const out: (Ad | AdvertiserResult)[] = [];
  const started = Date.now();
  const blocksBefore = client.blocks;
  const stats = await runScraper(normalizeInput(raw), {
    api,
    log: (m) => console.log(`${name}: ${m}`),
    emit: async (r) => (out.push(r), true),
  });
  const seconds = (Date.now() - started) / 1000;
  console.log(
    `\n== ${name}: ${out.length} items in ${seconds}s, ${client.requests} requests so far, ${client.blocks - blocksBefore} blocks`,
  );
  console.log(JSON.stringify(stats.targets));
  if (stats.contentErrors)
    problems.push(`${name}: ${stats.contentErrors} preview errors`);
  return { out, stats, seconds, blocks: client.blocks - blocksBefore };
}

function checkAd(name: string, a: Ad) {
  if (
    !/^AR\d+$/.test(a.advertiserId) ||
    !/^CR\d+$/.test(a.creativeId) ||
    !a.advertiserName ||
    !a.format ||
    Number.isNaN(Date.parse(a.firstShown ?? "")) ||
    Number.isNaN(Date.parse(a.lastShown ?? "")) ||
    !a.adUrl.startsWith("https://adstransparency.google.com/advertiser/")
  )
    problems.push(`${name}: bad ad ${JSON.stringify(a).slice(0, 300)}`);
  if (!a.imageUrl && !a.headline && !a.texts.length && !a.videoId)
    problems.push(
      `${name}: ad without content ${a.creativeId} ${a.previewUrl ?? ""}`,
    );
}

// 1. Default input.
console.log("Default input:", JSON.stringify(defaults));
const d = await run("default", defaults);
const ads = d.out as Ad[];
console.log(JSON.stringify(ads.slice(0, 2), null, 2));
const want = Number(defaults.maxAdsPerAdvertiser);
if (ads.length !== want) problems.push(`default: ${ads.length}/${want} ads`);
for (const a of ads) checkAd("default", a);
if (new Set(ads.map((a) => a.creativeId)).size !== ads.length)
  problems.push("default: duplicate ads");
const byFormat = ads.reduce<Record<string, number>>(
  (m, a) => ((m[a.format ?? "?"] = (m[a.format ?? "?"] ?? 0) + 1), m),
  {},
);
console.log("default formats:", byFormat);
if (d.seconds > 60) {
  (d.blocks ? console.warn : (m: string) => problems.push(m))(
    `default: took ${d.seconds}s (${d.blocks} rate-limit waits)`,
  );
}

// 2. Domain + text/video formats + date filter.
const v = await run("domain-formats", {
  advertisers: ["nike.com"],
  formats: ["text", "video"],
  // Text ads are often archived as screenshots; some render as HTML.
  region: "",
  dateFrom: "90 days",
  maxAdsPerAdvertiser: 6,
});
const dom = v.out as Ad[];
if (dom.length !== 6) problems.push(`domain-formats: ${dom.length}/6 ads`);
const since = new Date(Date.now() - 91 * 86_400_000).toISOString();
for (const a of dom) {
  checkAd("domain-formats", a);
  if (a.targetDomain !== "nike.com")
    problems.push(`domain-formats: domain ${a.targetDomain}`);
  if ((a.lastShown ?? "") < since)
    problems.push(`domain-formats: last shown ${a.lastShown} before filter`);
}
const texts = dom.filter((a) => a.format === "text");
const videos = dom.filter((a) => a.format === "video");
if (texts.length !== 3 || videos.length !== 3)
  problems.push(`domain-formats: ${texts.length} text, ${videos.length} video`);
// Text ads are often archived as screenshots (imageUrl only), so any format.
if (!dom.some((a) => a.headline && a.description))
  problems.push("domain-formats: no ad with headline + description");
if (!videos.some((a) => a.videoId || a.imageUrl))
  problems.push("domain-formats: videos without video ID or image");
for (const a of dom.slice(0, 1).concat(videos.slice(0, 1)))
  console.log(JSON.stringify(a, null, 2));

// 3. Pagination with a platform filter (raw API, small pages).
const filter = {
  advertiserIds: ["AR16735076323512287233"],
  regionId: 2840,
  platform: "YOUTUBE" as const,
};
const p1 = await api.searchCreatives(filter, 3);
const p2 = p1.nextPageToken
  ? await api.searchCreatives(filter, 3, p1.nextPageToken)
  : null;
console.log(
  "\n== pagination:",
  p1.totalEstimate,
  p1.ads.map((a) => a.creativeId),
  p2?.ads.map((a) => a.creativeId),
);
if (p1.ads.length !== 3 || p2?.ads.length !== 3)
  problems.push("pagination: expected two pages of 3");
else if (p2.ads.some((a) => p1.ads.some((b) => b.creativeId === a.creativeId)))
  problems.push("pagination: page 2 repeats page 1");

// 4. Advertiser search.
const s = await run("advertisers", {
  mode: "advertisers",
  advertisers: ["Supercell"],
  maxAdvertisersPerQuery: 5,
});
console.log(JSON.stringify(s.out.slice(0, 2)));
if (
  !s.out.some((a) => (a as AdvertiserResult).advertiserName === "Supercell Oy")
)
  problems.push("advertisers: Supercell Oy not found");

console.log(`\n${client.requests} requests total, ${client.blocks} blocks`);
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
