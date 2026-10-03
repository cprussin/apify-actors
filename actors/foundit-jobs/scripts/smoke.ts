/**
 * Live smoke test against foundit.in (no proxy, no Apify platform).
 * 1. Runs the input-schema default input (what Apify's daily test runs) and
 *    checks it finishes quickly with complete jobs.
 * 2. Checks a 2-page query without location and a location-only search.
 * With --record, saves the API responses used by the tests to test/fixtures
 * (synonym lists and facet filters stripped to keep them small).
 * Usage: npm run smoke -w actors/foundit-jobs [-- --record]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { searchUrl } from "../src/foundit.js";
import { gotFetch } from "../src/got-fetch.js";
import { FounditClient } from "../src/http.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import { runJobs, type JobResult } from "../src/run.js";

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
const http = new FounditClient({
  fetch: gotFetch(),
  minIntervalMs: 1000,
  log: console.warn,
});

async function run(name: string, raw: RawInput) {
  const out: JobResult[] = [];
  const started = Date.now();
  const input = normalizeInput(raw);
  const stats = await runJobs(input, {
    get: (url) => http.get(url),
    log: (m) => problems.push(`${name}: ${m}`),
    emit: async (r) => (out.push(r), true),
  });
  const seconds = (Date.now() - started) / 1000;
  console.log(
    `\n== ${name}: ${out.length} jobs from ${stats.pages} pages in ${seconds}s (${http.requests} requests, ${http.blocks} blocks)`,
  );
  for (const s of stats.searches)
    console.log(
      `  [${s.search}] ${s.status}: ${s.jobs} jobs, ${s.pages} pages, ${s.totalJobs} total`,
    );
  for (const j of out.slice(0, 4))
    console.log(
      `  ${j.title} @ ${j.companyName} ${j.locations.join("/")} ${j.experienceMin ?? "?"}-${j.experienceMax ?? "?"}y ${j.salaryMin ?? "?"}-${j.salaryMax ?? "?"} ${j.salaryCurrency ?? ""} ${j.postedAt?.slice(0, 10)} ${j.jobUrl}`,
    );
  for (const j of out) {
    // companyName is null for "confidential company" jobs.
    if (!j.title || !j.jobUrl || !j.locations.length)
      problems.push(`${name}: incomplete item ${j.jobId}`);
    if (!j.postedAt) problems.push(`${name}: no postedAt ${j.jobId}`);
  }
  const skilled = out.filter((j) => j.skills.length).length;
  console.log(
    `  ${skilled}/${out.length} with skills, ${out.filter((j) => j.salaryMax !== null).length} with salary`,
  );
  if (out.length && skilled < out.length / 2)
    problems.push(`${name}: only ${skilled}/${out.length} with skills`);
  if (new Set(out.map((j) => j.jobId)).size !== out.length)
    problems.push(`${name}: duplicate jobs`);
  if (!out.length) problems.push(`${name}: no results`);
  return { out, stats, seconds, input };
}

// 1. Default input.
console.log("Default input:", JSON.stringify(defaults));
const d = await run("default", defaults);
if (d.out.length !== d.input.maxItems)
  problems.push(`default: ${d.out.length}/${d.input.maxItems} jobs`);
if (d.seconds > 30) problems.push(`default: took ${d.seconds}s`);
console.log("\nSample:", JSON.stringify(d.out[0], null, 2));

// 2. Query only (all of India and SEA), 2 pages, with description.
const q = await run("query", {
  queries: ["data analyst"],
  maxItems: 40,
  includeDescription: true,
  sortBy: "relevance",
});
if (q.stats.pages !== 2) problems.push("query: expected 2 pages");
if (q.out.some((j) => !j.description))
  problems.push("query: description missing");

// 3. Location only.
const loc = await run("location", { locations: ["Pune"], maxItems: 5 });
if (loc.out.some((j) => !j.locations.some((l) => /pune/i.test(l))))
  console.warn("  note: some location-only jobs are not tagged Pune");

if (process.argv.includes("--record")) {
  const slim = (body: string) =>
    JSON.stringify(
      JSON.parse(body, (k, v) =>
        k === "synonyms" || k === "skillsWithSynonyms" || k === "filter"
          ? undefined
          : v,
      ),
    );
  const fixtures: [string, string][] = [
    [
      "python-developer-bangalore.json",
      searchUrl({ query: "python developer", location: "Bangalore" }, 0),
    ],
    [
      "python-developer-bangalore-p2.json",
      searchUrl({ query: "python developer", location: "Bangalore" }, 20),
    ],
    [
      "data-analyst.json",
      searchUrl({ query: "data analyst", location: null }, 0, "relevance"),
    ],
    [
      "no-results.json",
      searchUrl({ query: "zzqxv plorbt", location: "Pune" }, 0),
    ],
  ];
  for (const [file, url] of fixtures) {
    const page = await http.get(url);
    writeFileSync(
      new URL(`../test/fixtures/${file}`, import.meta.url),
      `${slim(page.body)}\n`,
    );
    console.log(`Recorded ${file} from ${url}`);
  }
}

console.log(`\n${http.requests} requests total, ${http.blocks} blocked`);
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
