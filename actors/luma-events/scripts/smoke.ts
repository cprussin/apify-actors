/**
 * Live smoke test against api.lu.ma (no Apify proxy, no Apify platform).
 * 1. Runs the input-schema default input (what Apify's daily test runs) and
 *    checks it finishes quickly with complete events, including details.
 * 2. Checks a category search over 2+ pages without details, a keyword
 *    search, a point search and a calendar start URL.
 * Honors HTTPS_PROXY (for sandboxed dev environments).
 * Usage: npm run smoke -w actors/luma-events
 */
import { readFileSync } from "node:fs";
import { gotFetch } from "../src/got-fetch.js";
import { LumaClient } from "../src/http.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import type { EventResult } from "../src/luma.js";
import { runEvents } from "../src/run.js";

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
const http = new LumaClient({
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
    `\n== ${name}: ${out.length} events from ${stats.pages} pages + ${stats.detailPages} details in ${seconds}s (${http.requests} requests, ${http.blocks} blocks)`,
  );
  for (const t of stats.targets)
    console.log(
      `  [${t.target}] ${t.kind} ${t.status}: ${t.events} events, ${t.pages} pages`,
    );
  for (const e of out.slice(0, 3))
    console.log(
      `  ${e.startLocal} ${e.timezone} | ${e.name} @ ${e.isOnline ? "online" : `${e.venueName ?? "(hidden)"}, ${e.venueCity}`} | ${e.hostNames.slice(0, 2).join(", ")} | ${e.isFree ? "free" : `${e.priceMin ?? "?"}-${e.priceMax ?? "?"} ${e.currency ?? ""}`} | guests ${e.guestCount} | ${e.url}`,
    );
  for (const e of out) {
    if (!e.eventId || !e.name || !e.url || !e.startUtc || !e.timezone)
      problems.push(`${name}: incomplete item ${e.eventId}`);
    if (e.isOnline === false && e.latitude === null)
      problems.push(`${name}: no coordinates ${e.eventId}`);
    if ("featured_guests" in e || "guests" in e)
      problems.push(`${name}: guest data in ${e.eventId}`);
  }
  if (input.includeDetails) {
    const described = out.filter((e) => e.description).length;
    const typed = out.filter((e) => e.ticketTypes?.length).length;
    console.log(
      `  ${described}/${out.length} with description, ${typed}/${out.length} with ticket types`,
    );
    if (described < out.length * 0.7)
      problems.push(`${name}: only ${described}/${out.length} described`);
  }
  if (new Set(out.map((e) => e.eventId)).size !== out.length)
    problems.push(`${name}: duplicate events`);
  if (!out.length) problems.push(`${name}: no results`);
  return { out, stats, seconds, input };
}

// 1. Default input (NYC, 20 events with details).
console.log("Default input:", JSON.stringify(defaults));
const d = await run("default", defaults);
if (d.out.length !== d.input.maxEvents)
  problems.push(`default: ${d.out.length}/${d.input.maxEvents} events`);
if (d.seconds > 60) problems.push(`default: took ${d.seconds}s`);
if (d.out.some((e) => e.venueCountryCode && e.venueCountryCode !== "US"))
  problems.push("default: event outside the US");

// 2. San Francisco AI events, 2+ pages, no details.
const sf = await run("sf-ai", {
  cities: ["sf"],
  category: "ai",
  maxEvents: 80,
  includeDetails: false,
});
if (sf.stats.pages < 2) problems.push("sf-ai: expected 2+ pages");
if (sf.out.some((e) => "description" in e))
  problems.push("sf-ai: description not omitted");
const bay = sf.out.filter((e) => e.venueRegion === "California").length;
if (bay < sf.out.length * 0.8)
  problems.push(`sf-ai: only ${bay}/${sf.out.length} in California`);

// 3. London keyword search.
const london = await run("london-hackathon", {
  cities: ["london"],
  keyword: "hackathon",
  maxEvents: 10,
  includeDetails: false,
});
const hits = london.out.filter((e) => /hack/i.test(e.name ?? "")).length;
if (hits < london.out.length * 0.5)
  problems.push(`london-hackathon: only ${hits}/${london.out.length} match`);

// 4. A point (Boulder, CO).
const boulder = await run("boulder", {
  cities: ["40.015,-105.27"],
  maxEvents: 10,
  includeDetails: false,
});
if (boulder.out.some((e) => e.venueRegion && e.venueRegion !== "Colorado"))
  problems.push("boulder: event outside Colorado");

// 5. A calendar start URL.
const cal = await run("calendar", {
  startUrls: ["https://luma.com/genai-sf"],
  maxEvents: 10,
  includeDetails: false,
});
if (cal.stats.targets[0]?.kind !== "calendar")
  problems.push("calendar: not resolved as a calendar");
if (cal.out.some((e) => e.source !== "calendar:genai-sf"))
  problems.push("calendar: wrong source");

console.log(`\n${http.requests} requests total, ${http.blocks} blocked`);
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
