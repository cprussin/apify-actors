/**
 * Live smoke test against instahyre.com (no proxy, no Apify platform).
 * 1. Runs the input-schema default input (what Apify's daily test runs) and
 *    checks it finishes quickly with complete jobs.
 * 2. Checks filters (location, years, job function, company size, internship)
 *    and paging, then a monitor-mode baseline + rerun.
 * Honors HTTPS_PROXY (for sandboxed dev environments).
 * With --record, saves the API responses used by the tests to test/fixtures
 * (trimmed to a few jobs, long employer notes and facet counts dropped).
 * Usage: npm run smoke -w actors/instahyre-jobs [-- --record]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gotFetch } from "../src/got-fetch.js";
import { InstahyreClient } from "../src/http.js";
import {
  detailUrl,
  JOB_FUNCTIONS_URL,
  searchUrl,
  type SearchFilters,
} from "../src/instahyre.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import { runJobs, type JobResult } from "../src/run.js";
import { MonitorState } from "../src/state.js";

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
const http = new InstahyreClient({
  fetch: gotFetch(envProxy ? async () => envProxy : undefined),
  minIntervalMs: 1000,
  log: console.warn,
});

async function run(name: string, raw: RawInput, state?: MonitorState) {
  const out: JobResult[] = [];
  const started = Date.now();
  const input = normalizeInput(raw);
  const stats = await runJobs(input, {
    get: (url) => http.get(url),
    log: (m) => console.warn(`  ${name}: ${m}`),
    emit: async (r) => (out.push(r), true),
    state,
  });
  const seconds = (Date.now() - started) / 1000;
  console.log(
    `\n== ${name}: ${out.length} jobs from ${stats.pages} pages in ${seconds}s (${stats.totalJobs} matching, ${stats.filteredOut} outside locations, ${stats.unchanged} unchanged, ${stats.removed} removed; ${http.requests} requests, ${http.blocks} blocks)`,
  );
  for (const j of out.slice(0, 3))
    console.log(
      `  ${j.title} @ ${j.employerName} (${j.employerHeadcount}, ${j.employerFoundedYear}) ${j.locations.join("/")} [${j.keywords.join(", ")}] ${j.changeType ?? ""} ${j.jobUrl}`,
    );
  for (const j of out) {
    if (j.changeType === "removed") continue;
    if (!j.title || !j.jobUrl || !j.employerName || !j.employerId)
      problems.push(`${name}: incomplete item ${j.jobId}`);
  }
  if (new Set(out.map((j) => j.jobId)).size !== out.length)
    problems.push(`${name}: duplicate jobs`);
  return { out, stats, seconds, input };
}

// 1. Default input.
console.log("Default input:", JSON.stringify(defaults));
const d = await run("default", defaults);
if (d.out.length !== d.input.maxItems)
  problems.push(`default: ${d.out.length}/${d.input.maxItems} jobs`);
if (d.seconds > 30) problems.push(`default: took ${d.seconds}s`);
if (d.out.some((j) => !j.keywords.length))
  problems.push("default: job without keywords");
console.log("\nSample:", JSON.stringify(d.out[0], null, 2));

// 2. Filters + paging (2 pages of 35).
const f = await run("filters", {
  skills: ["Java"],
  locations: ["Pune", "Bengaluru"],
  years: 3,
  jobFunctions: ["Backend Development"],
  companySize: "large",
  jobType: "full-time",
  maxItems: 40,
});
if (f.out.length !== 40) problems.push(`filters: ${f.out.length}/40 jobs`);
if (f.out.some((j) => !j.locations.some((l) => /pune|bangalore/i.test(l))))
  problems.push("filters: job outside Pune/Bangalore");
if (f.out.some((j) => (j.employerHeadcount ?? 0) < 200))
  problems.push("filters: small company in large-company search");

const intern = await run("internship", { jobType: "internship", maxItems: 5 });
if (!intern.out.length) problems.push("internship: no results");

// 3. Monitor mode: baseline, then a rerun with the saved state.
const mInput = { skills: ["Rust"], years: 5, maxItems: 500, monitorMode: true };
const state = new MonitorState();
const m1 = await run("monitor baseline", mInput, state);
if (!m1.out.length || m1.out.some((j) => j.changeType !== "new"))
  problems.push("monitor baseline: expected only new jobs");
if (!m1.stats.complete) problems.push("monitor baseline: incomplete scan");
const m2 = await run(
  "monitor rerun",
  mInput,
  new MonitorState(JSON.parse(JSON.stringify(state.toJSON()))),
);
if (m2.stats.unchanged < m1.out.length * 0.8)
  problems.push(
    `monitor rerun: only ${m2.stats.unchanged}/${m1.out.length} unchanged`,
  );

if (process.argv.includes("--record")) {
  const slimJob = (j: Record<string, unknown>) => {
    const e = { ...(j.employer as Record<string, unknown>) };
    delete e.instahyre_note;
    return { ...j, employer: e };
  };
  const slimSearch = (body: string, n: number) => {
    const json = JSON.parse(body) as {
      meta: Record<string, unknown>;
      objects: Record<string, unknown>[];
    };
    const { offset, limit, total_count, next, previous } = json.meta;
    return {
      meta: { offset, limit, total_count, next, previous },
      objects: json.objects.slice(0, n).map(slimJob),
    };
  };
  const base: SearchFilters = {
    skills: [],
    locations: [],
    years: null,
    jobFunctionIds: [],
    companySize: null,
    jobType: null,
  };
  const py = { ...base, skills: ["Python"] };
  const fixtures: [string, string, (body: string) => unknown][] = [
    ["python.json", searchUrl(py, 0), (b) => slimSearch(b, 8)],
    ["python-p2.json", searchUrl(py, 35), (b) => slimSearch(b, 8)],
    [
      "internship.json",
      searchUrl({ ...base, jobType: "internship" }, 0),
      (b) => slimSearch(b, 4),
    ],
    [
      "no-results.json",
      searchUrl({ ...base, skills: ["zzqxvplorbt"] }, 0),
      (b) => slimSearch(b, 0),
    ],
    [
      "job.json",
      detailUrl(d.out[0]!.jobId),
      (b) => slimJob(JSON.parse(b) as Record<string, unknown>),
    ],
    [
      "job-functions.json",
      JOB_FUNCTIONS_URL,
      (b) => {
        const json = JSON.parse(b) as { objects: Record<string, unknown>[] };
        const keep = new Set([1, 3, 9, 10, 8, 11]);
        return {
          objects: json.objects
            .filter((o) => keep.has(o.id as number))
            .map(({ id, name, slug }) => ({ id, name, slug })),
        };
      },
    ],
  ];
  for (const [file, url, slim] of fixtures) {
    const page = await http.get(url);
    writeFileSync(
      new URL(`../test/fixtures/${file}`, import.meta.url),
      `${JSON.stringify(slim(page.body))}\n`,
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
