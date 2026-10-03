/**
 * Live smoke test against eventbrite.com (no Apify proxy, no Apify platform).
 * 1. Runs the input-schema default input (what Apify's daily test runs) and
 *    checks it finishes quickly with complete events, including details.
 * 2. Checks a category + date search over 2 pages without details, and a
 *    keyword search in another country with details.
 * Honors HTTPS_PROXY (for sandboxed dev environments).
 * Usage: npm run smoke -w actors/eventbrite-events
 */
import { readFileSync } from "node:fs";
import { gotFetch } from "../src/got-fetch.js";
import { EventbriteClient } from "../src/http.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import { runEvents, type EventResult } from "../src/run.js";

const schema = JSON.parse(
  readFileSync(new URL("../.actor/input_schema.json", import.meta.url), "utf8"),
) as { properties: Record<string, { default?: unknown; prefill?: unknown }> };
const defaults = Object.fromEntries(
  Object.entries(schema.properties)
    .filter(([, p]) => p.prefill !== undefined || p.default !== undefined)
    .filter(([k]) => k !== "proxyConfiguration")
    .map(([k, p]) => [k, p.prefill ?? p.default]),
) as RawInput;

const problems: string[] = [];
const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const http = new EventbriteClient({
  fetch: gotFetch(envProxy ? async () => envProxy : undefined),
  log: console.warn,
});

async function run(name: string, raw: RawInput) {
  const out: EventResult[] = [];
  const started = Date.now();
  const input = normalizeInput(raw);
  const stats = await runEvents(input, {
    get: (url) => http.get(url),
    log: (m) => problems.push(`${name}: ${m}`),
    emit: async (r) => (out.push(r), true),
  });
  const seconds = (Date.now() - started) / 1000;
  console.log(
    `\n== ${name}: ${out.length} events from ${stats.pages} pages + ${stats.detailPages} event pages in ${seconds}s (${http.requests} requests, ${http.blocks} blocks)`,
  );
  for (const s of stats.searches)
    console.log(
      `  [${s.search}] ${s.status}: ${s.events} events, ${s.pages} pages, ${s.totalEvents} total`,
    );
  for (const e of out.slice(0, 4))
    console.log(
      `  ${e.startDate} ${e.timezone} | ${e.name} @ ${e.isOnline ? "online" : `${e.venueName}, ${e.venueCity}`} | ${e.organizerName ?? "?"} | ${e.isFree ? "free" : `${e.priceMin ?? "?"}-${e.priceMax ?? "?"} ${e.currency ?? ""}`} | ${e.category} | ${e.url}`,
    );
  for (const e of out) {
    if (!e.eventId || !e.name || !e.url || !e.startUtc || !e.timezone)
      problems.push(`${name}: incomplete item ${e.eventId}`);
    if (!e.isOnline && (e.latitude === null || !e.venueName))
      problems.push(`${name}: no venue ${e.eventId}`);
  }
  if (input.includeDetails) {
    const detailed = out.filter((e) => e.organizerName).length;
    const priced = out.filter((e) => e.priceMax !== null || e.isFree).length;
    console.log(
      `  ${detailed}/${out.length} with organizer, ${priced}/${out.length} with price`,
    );
    if (detailed < out.length * 0.9)
      problems.push(`${name}: only ${detailed}/${out.length} with organizer`);
    if (priced < out.length * 0.7)
      problems.push(`${name}: only ${priced}/${out.length} with price`);
  }
  if (new Set(out.map((e) => e.eventId)).size !== out.length)
    problems.push(`${name}: duplicate events`);
  if (!out.length) problems.push(`${name}: no results`);
  return { out, stats, seconds, input };
}

// 1. Default input (New York, 20 events with details).
console.log("Default input:", JSON.stringify(defaults));
const d = await run("default", defaults);
if (d.out.length !== d.input.maxEvents)
  problems.push(`default: ${d.out.length}/${d.input.maxEvents} events`);
if (d.seconds > 60) problems.push(`default: took ${d.seconds}s`);

// 2. San Francisco music this week, 2 pages, no details.
const sf = await run("sf-music", {
  locations: ["ca--san-francisco"],
  category: "music",
  dateFilter: "this-week",
  maxEvents: 40,
  includeDetails: false,
});
if (sf.stats.pages !== 2) problems.push("sf-music: expected 2 pages");
if (sf.out.some((e) => e.category !== "Music"))
  problems.push("sf-music: non-music event");
if (sf.out.some((e) => "description" in e))
  problems.push("sf-music: description not omitted");

// 3. London keyword search with details.
const london = await run("london-tech", {
  locations: ["united-kingdom--london"],
  keyword: "tech",
  maxEvents: 5,
});
if (london.out.some((e) => !e.isOnline && e.venueCountry !== "GB"))
  problems.push("london-tech: venue outside GB");
if (!london.out.some((e) => e.description))
  problems.push("london-tech: no descriptions");

console.log(`\n${http.requests} requests total, ${http.blocks} blocked`);
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
