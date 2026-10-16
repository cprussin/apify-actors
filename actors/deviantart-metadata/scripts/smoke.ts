/**
 * Live smoke test against DeviantArt's public pages (no Apify platform needed).
 * 1. Runs the input-schema prefill input (what Apify's daily test runs).
 * 2. Checks gallery (paging + sinceDate), profile, deviation URLs, includeTags
 *    and the oEmbed/RSS fallbacks.
 * 3. Checks no request hit a robots.txt-disallowed path or an image.
 *
 * Set SMOKE_PROXY_URL=http://user:pass@host:port to route through a proxy.
 * Usage: npm run smoke -w actors/deviantart-metadata
 */
import { readFileSync } from "node:fs";
import { DeviantArtClient } from "../src/deviantart.js";
import { HttpClient, type FetchLike } from "../src/http.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import type { Item } from "../src/item.js";
import { proxiedFetch } from "../src/proxy-fetch.js";
import { runScrape } from "../src/run.js";

const schema = JSON.parse(
  readFileSync(new URL("../.actor/input_schema.json", import.meta.url), "utf8"),
) as { properties: Record<string, { default?: unknown; prefill?: unknown }> };
const prefill = Object.fromEntries(
  Object.entries(schema.properties)
    .map(([k, p]) => [k, p.prefill ?? p.default] as const)
    .filter(([, v]) => v !== undefined),
) as RawInput;

const proxyUrl = process.env.SMOKE_PROXY_URL;
const base: FetchLike = proxyUrl
  ? proxiedFetch(async () => proxyUrl)
  : (globalThis.fetch as unknown as FetchLike);
const requested: string[] = [];
const http = new HttpClient({
  fetch: (url, init) => (requested.push(url), base(url, init)),
  log: console.warn,
});
const client = new DeviantArtClient(http);
const problems: string[] = [];
const NERA = "https://www.deviantart.com/wlop/art/Nera2-1385671838";

async function run(name: string, raw: RawInput) {
  const out: Item[] = [];
  const started = Date.now();
  const stats = await runScrape(normalizeInput(raw), {
    client,
    log: (m) => console.warn(`  ${name}: ${m}`),
    emit: async (i) => (out.push(i), true),
  });
  const seconds = (Date.now() - started) / 1000;
  console.log(`\n== ${name}: ${out.length} items in ${seconds}s`);
  console.log(JSON.stringify(stats));
  return { out, stats, seconds };
}

const checkDeviation = (name: string, d: Item) => {
  if (!d.id || !d.title || !d.url?.startsWith("https://www.deviantart.com/"))
    problems.push(`${name}: missing core fields ${JSON.stringify(d)}`);
  if (d.dataSource !== "page") problems.push(`${name}: ${d.dataSource} item`);
  for (const k of [
    "views",
    "favourites",
    "comments",
    "authorWatchers",
  ] as const)
    if (typeof d[k] !== "number") problems.push(`${name} ${d.id}: no ${k}`);
  for (const k of ["noai", "isMature", "isDownloadable"] as const)
    if (typeof d[k] !== "boolean") problems.push(`${name} ${d.id}: no ${k}`);
  if (!d.author || !d.publishedAt || !d.license)
    problems.push(`${name} ${d.id}: no author/publishedAt/license`);
  if (!d.thumbnailUrl?.startsWith("https://"))
    problems.push(`${name} ${d.id}: no thumbnailUrl`);
};

// 1. Prefill input (what the daily test runs).
const def = await run("prefill", prefill);
if (def.out.length !== prefill.maxItems)
  problems.push(`prefill: ${def.out.length}/${prefill.maxItems} items`);
if (def.seconds > 45) problems.push(`prefill took ${def.seconds}s`);
def.out.forEach((d) => checkDeviation("prefill", d));
console.log(JSON.stringify(def.out[0], null, 2));

// 2. Gallery: two pages, then sinceDate stops early.
const gal = await run("gallery", {
  mode: "userGallery",
  usernames: ["wlop"],
  maxItems: 12,
});
if (gal.out.length !== 12) problems.push(`gallery: ${gal.out.length}/12`);
gal.out.forEach((d) => checkDeviation("gallery", d));
const dates = gal.out.map((d) => Date.parse(d.publishedAt!));
if (dates.some((t, i) => i > 0 && t > dates[i - 1]!))
  problems.push("gallery: not newest first");

const since = new Date(dates[2]! - 1).toISOString();
const before = http.requests;
const mon = await run("gallery-since", {
  mode: "userGallery",
  usernames: ["wlop"],
  maxItems: 100,
  sinceDate: since,
});
if (mon.out.length < 3 || mon.out.some((d) => d.publishedAt! < since))
  problems.push(`gallery-since: ${mon.out.length} items, since ${since}`);
if (http.requests - before > 2)
  problems.push(`gallery-since: ${http.requests - before} requests`);

// 3. Profile.
const prof = await run("profile", { mode: "userProfile", usernames: ["wlop"] });
const p = prof.out[0];
if (
  !p ||
  p.type !== "profile" ||
  !(p.watchers! > 0) ||
  !(p.deviationCount! > 0) ||
  !(p.pageviews! > 0)
)
  problems.push(`profile: ${JSON.stringify(p)}`);

// 4. Deviation URLs (with tags) + an unknown one.
const dev = await run("deviationUrls", {
  mode: "deviationUrls",
  deviationUrls: [NERA, "https://www.deviantart.com/wlop/art/Nope-1"],
});
if (dev.out.length !== 1 || dev.stats.notFound !== 1)
  problems.push(
    `deviationUrls: ${dev.out.length} items/${dev.stats.notFound} notFound`,
  );
if (dev.out[0]) {
  checkDeviation("deviationUrls", dev.out[0]);
  if (!dev.out[0].tags?.length) problems.push("deviationUrls: no tags");
}

// 5. includeTags on search.
const tagged = await run("search-tags", {
  query: "landscape",
  maxItems: 3,
  includeTags: true,
});
if (tagged.out.length !== 3 || tagged.out.some((d) => !Array.isArray(d.tags)))
  problems.push("search-tags: tags not filled");

// 6. Fallback endpoints answer.
const rss = await client.rss("by:wlop", 0);
if (rss.items.length < 10) problems.push(`rss: ${rss.items.length} items`);
const oe = await client.deviationViaOembed(NERA, NERA);
if (!oe?.title || typeof oe.views !== "number")
  problems.push(`oembed: ${JSON.stringify(oe)}`);
console.log(
  `\nrss ${rss.items.length} items; oembed "${oe?.title}" ${oe?.views} views`,
);

// 7. Politeness: only allowed paths, never images.
const bad = requested.filter(
  (u) =>
    /cursor=|_puppy|\/api\/|\/users\/|\/download\//.test(u) ||
    /wixmp\.com|\.jpe?g|\.png/.test(u),
);
if (bad.length) problems.push(`disallowed requests: ${bad.join(", ")}`);

console.log(`\n${http.requests} requests total`);
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
