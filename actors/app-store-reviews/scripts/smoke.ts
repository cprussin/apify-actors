/**
 * Live smoke test against the App Store and Google Play.
 * 1. Runs the input-schema default input (what Apify's daily test runs) and
 *    checks it finishes well under 60 s with valid reviews from both stores.
 * 2. Checks pagination, other countries, delta mode and developer replies.
 * Usage: npm run smoke -w actors/app-store-reviews
 */
import { readFileSync } from "node:fs";
import { AppleSource } from "../src/apple.js";
import { GoogleSource } from "../src/google.js";
import { HttpClient } from "../src/http.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import type { Review } from "../src/review.js";
import { runReviews } from "../src/run.js";

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
const sources = {
  apple: new AppleSource(http),
  google: new GoogleSource(http),
};

async function run(name: string, raw: RawInput) {
  const out: Review[] = [];
  const started = Date.now();
  const stats = await runReviews(normalizeInput(raw), {
    sources,
    log: (m) => problems.push(`${name}: ${m}`),
    emit: async (r) => (out.push(r), true),
  });
  const seconds = (Date.now() - started) / 1000;
  console.log(`\n== ${name}: ${out.length} reviews in ${seconds}s`);
  console.log(JSON.stringify(stats.apps));
  for (const r of out) {
    if (
      !r.reviewId ||
      !r.appId ||
      !(r.rating >= 1 && r.rating <= 5) ||
      Number.isNaN(Date.parse(r.date)) ||
      typeof r.text !== "string" ||
      !r.url.startsWith("https://")
    )
      problems.push(`${name}: bad review ${JSON.stringify(r)}`);
  }
  if (new Set(out.map((r) => `${r.store}:${r.reviewId}`)).size !== out.length)
    problems.push(`${name}: duplicate reviews`);
  return { out, stats, seconds };
}

// 1. Default input.
console.log("Default input:", JSON.stringify(defaults));
const d = await run("default", defaults);
console.log(JSON.stringify(d.out.slice(0, 2), null, 2));
const perApp = Number(defaults.maxReviewsPerApp);
for (const store of ["apple", "google"] as const) {
  const n = d.out.filter((r) => r.store === store).length;
  if (n !== perApp) problems.push(`default: ${store} ${n}/${perApp} reviews`);
  const s = d.out.find((r) => r.store === store);
  if (!s?.appName) problems.push(`default: ${store} app name missing`);
  if (!d.out.some((r) => r.store === store && r.appVersion))
    problems.push(`default: ${store} has no app versions`);
}
if (d.seconds > 30) problems.push(`default: took ${d.seconds}s`);

// 2. Pagination beyond one page per store, newest first.
const p = await run("pagination", {
  apps: ["id324684580", "com.spotify.music"],
  maxReviewsPerApp: 350,
});
for (const store of ["apple", "google"] as const) {
  const dates = p.out.filter((r) => r.store === store).map((r) => r.date);
  if (dates.length !== 350)
    problems.push(`pagination: ${store} ${dates.length}/350`);
  const sorted = [...dates].sort().reverse();
  const outOfOrder = dates.filter((x, i) => x !== sorted[i]).length;
  if (outOfOrder > dates.length * 0.1)
    problems.push(`pagination: ${store} not newest-first`);
}

// 3. Developer replies, other country/language, rating filter, delta mode.
const r = await run("replies-de", {
  apps: ["id1459969523", "com.robinhood.android"],
  country: "de",
  language: "de",
  maxReviewsPerApp: 150,
});
for (const store of ["apple", "google"] as const) {
  if (!r.out.some((x) => x.store === store && x.developerReply))
    console.warn(`replies-de: no developer replies from ${store} (warning)`);
  if (!r.out.some((x) => x.store === store && x.country === "de"))
    problems.push(`replies-de: no ${store} reviews`);
}
const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
const f = await run("delta", {
  apps: ["id324684580", "com.spotify.music"],
  sinceDate: "7 days",
  maxRating: 2,
  maxReviewsPerApp: 50,
});
if (f.out.some((x) => x.date < since.slice(0, 13) || x.rating > 2))
  problems.push("delta: filter violated");
if (!f.out.length) problems.push("delta: no results");
const bad = await run("not-found", {
  apps: ["id99999", "com.nonexistent.zzzqqq"],
});
if (
  bad.out.length ||
  Object.values(bad.stats.apps).some((s) => s.status !== "notFound")
)
  problems.push("not-found: expected notFound for both apps");
problems.splice(
  0,
  problems.length,
  ...problems.filter((m) => !/^not-found: .*not found/.test(m)),
);

console.log(`\n${http.requests} requests total`);
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
