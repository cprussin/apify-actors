/**
 * Live smoke test against wellfound.com (no proxy, no Apify platform).
 * 1. Runs the input-schema default input (what Apify's daily test runs) and
 *    checks it finishes quickly with complete jobs.
 * 2. Checks a remote search over 2 pages and a location-only start URL.
 * Usage: npm run smoke -w actors/wellfound-jobs
 */
import { readFileSync } from "node:fs";
import { gotFetch } from "../src/got-fetch.js";
import { WellfoundClient } from "../src/http.js";
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
const http = new WellfoundClient({ fetch: gotFetch(), log: console.warn });

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
      `  ${j.title} @ ${j.companyName} (${j.companyStage ?? "?"}, ${j.companySize ?? "?"}) ${j.locations.join("/")}${j.remote ? " [remote]" : ""} ${j.salaryMin ?? "?"}-${j.salaryMax ?? "?"} ${j.salaryCurrency ?? ""} eq ${j.equityMin ?? "?"}-${j.equityMax ?? "?"}% ${j.jobType} ${j.postedAt?.slice(0, 10)} ${j.jobUrl}`,
    );
  for (const j of out) {
    if (!j.title || !j.companyName || !j.jobUrl || !j.companyUrl)
      problems.push(`${name}: incomplete item ${j.jobId}`);
    if (!j.postedAt) problems.push(`${name}: no postedAt ${j.jobId}`);
  }
  const salaried = out.filter((j) => j.salaryMax !== null).length;
  console.log(`  ${salaried}/${out.length} with salary`);
  if (out.length && salaried < out.length / 3)
    problems.push(`${name}: only ${salaried}/${out.length} with salary`);
  if (new Set(out.map((j) => j.jobId)).size !== out.length)
    problems.push(`${name}: duplicate jobs`);
  if (!out.length) problems.push(`${name}: no results`);
  return { out, stats, seconds, input };
}

// 1. Default input.
console.log("Default input:", JSON.stringify(defaults));
const d = await run("default", defaults);
if (d.out.length !== d.input.maxJobs)
  problems.push(`default: ${d.out.length}/${d.input.maxJobs} jobs`);
if (d.seconds > 30) problems.push(`default: took ${d.seconds}s`);

// 2. Remote, 2 pages, by name not slug.
const remote = await run("remote", {
  roles: ["Data Analyst"],
  locations: ["Remote"],
  maxPages: 2,
  maxJobs: 1000,
  includeDescription: false,
});
if (remote.stats.pages !== 2) problems.push("remote: expected 2 pages");
if (remote.out.some((j) => !j.remote)) problems.push("remote: non-remote job");
if (remote.out.some((j) => "description" in j))
  problems.push("remote: description not omitted");

// 3. Another role/location + a location-only start URL.
const mixed = await run("mixed", {
  roles: ["product-manager"],
  locations: ["new-york"],
  startUrls: ["https://wellfound.com/location/austin"],
  maxPages: 1,
  maxJobs: 1000,
});
if (mixed.stats.searches.some((s) => s.status !== "done"))
  problems.push("mixed: a search did not finish");

console.log(`\n${http.requests} requests total, ${http.blocks} blocked`);
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
