/**
 * Live smoke test against hirist.tech and iimjobs.com (no proxy, no Apify
 * platform). iimjobs requests are spaced 10 s apart, so this takes ~1-2 min.
 * 1. Runs the input-schema default input (what Apify's daily test runs) and
 *    checks it finishes quickly with complete jobs from both sites.
 * 2. Checks a 2-page Hirist search with location and experience filters.
 * 3. Checks descriptions on both sites.
 * With --record, saves the API responses used by the tests to test/fixtures
 * (company review/showcase blobs stripped to keep them small).
 * Usage: npm run smoke -w actors/hirist-iimjobs-jobs [-- --record]
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  detailUrl,
  MIN_INTERVAL_MS,
  searchUrl,
  SITES,
  type Search,
  type Site,
} from "../src/gladiator.js";
import { gotFetch } from "../src/got-fetch.js";
import { GladiatorClient } from "../src/http.js";
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
const clients = Object.fromEntries(
  SITES.map((s) => [
    s,
    new GladiatorClient({
      fetch: gotFetch(),
      minIntervalMs: MIN_INTERVAL_MS[s],
      log: console.warn,
    }),
  ]),
) as Record<Site, GladiatorClient>;
const requests = () =>
  SITES.map((s) => `${s} ${clients[s].requests}/${clients[s].blocks}`).join(
    ", ",
  );

async function run(name: string, raw: RawInput) {
  const out: JobResult[] = [];
  const started = Date.now();
  const input = normalizeInput(raw);
  const stats = await runJobs(input, {
    get: (url, site) => clients[site].get(url),
    log: (m) => problems.push(`${name}: ${m}`),
    emit: async (r) => (out.push(r), true),
  });
  const seconds = (Date.now() - started) / 1000;
  console.log(
    `\n== ${name}: ${out.length} jobs from ${stats.pages} pages in ${seconds}s (requests/blocks: ${requests()})`,
  );
  for (const s of stats.searches)
    console.log(
      `  [${s.search}] ${s.status}: ${s.jobs} jobs, ${s.pages} pages, ${s.totalJobs} total`,
    );
  for (const j of out.slice(0, 4))
    console.log(
      `  ${j.site} ${j.title} @ ${j.company} ${j.locations.join("/")} ${j.experienceMin ?? "?"}-${j.experienceMax ?? "?"}y ${j.salaryMin ?? "?"}-${j.salaryMax ?? "?"} ${j.postedAt?.slice(0, 10)} ${j.jobUrl}`,
    );
  for (const j of out) {
    // company is null for confidential jobs.
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
  if (new Set(out.map((j) => `${j.site}:${j.jobId}`)).size !== out.length)
    problems.push(`${name}: duplicate jobs`);
  if (!out.length) problems.push(`${name}: no results`);
  return { out, stats, seconds, input };
}

const bySite = (out: JobResult[], site: Site) =>
  out.filter((j) => j.site === site);

// 1. Default input: both sites, split evenly.
console.log("Default input:", JSON.stringify(defaults));
const d = await run("default", defaults);
if (d.out.length !== d.input.maxItems)
  problems.push(`default: ${d.out.length}/${d.input.maxItems} jobs`);
for (const s of SITES)
  if (bySite(d.out, s).length !== d.input.maxItems / 2)
    problems.push(`default: ${bySite(d.out, s).length} ${s} jobs`);
if (d.seconds > 30) problems.push(`default: took ${d.seconds}s`);
for (const s of SITES)
  console.log(`\nSample (${s}):`, JSON.stringify(bySite(d.out, s)[0], null, 2));

// 2. Hirist, 2 pages, location + experience filters.
const h = await run("hirist filters", {
  site: "hirist",
  queries: ["python developer"],
  locations: ["Bangalore", "Pune"],
  minExperience: 3,
  maxExperience: 6,
  maxItems: 60,
});
if (h.stats.pages !== 2) problems.push("hirist filters: expected 2 pages");
for (const j of h.out) {
  if (!j.locations.some((l) => /bangalore|pune/i.test(l)))
    console.warn(`  note: ${j.jobId} not in Bangalore/Pune: ${j.locations}`);
  if ((j.experienceMax ?? 99) < 3 || (j.experienceMin ?? 0) > 6)
    problems.push(`hirist filters: ${j.jobId} outside 3-6 yrs`);
}

// 3. Descriptions on both sites.
const desc = await run("descriptions", {
  queries: ["marketing manager"],
  maxItems: 4,
  includeDescription: true,
});
for (const s of SITES)
  if (bySite(desc.out, s).length !== 2)
    problems.push(`descriptions: ${bySite(desc.out, s).length} ${s} jobs`);
if (desc.out.some((j) => !j.description || !j.descriptionSnippet))
  problems.push("descriptions: description missing");

if (process.argv.includes("--record")) {
  const DROP = new Set([
    "ambitionBoxInfo",
    "showcase",
    "diversity",
    "cluster",
    "subCluster",
    "clustersDetail",
    "subClustersDetail",
    "logoPath",
    "companyLogoFilePath",
  ]);
  const slim = (body: string) =>
    JSON.stringify(JSON.parse(body, (k, v) => (DROP.has(k) ? undefined : v)));
  const search = (site: Site, query: string, loc: number[] = []): Search => ({
    site,
    query,
    locationIds: loc,
    minExperience: null,
    maxExperience: null,
  });
  const first = (j: JobResult[], s: Site) => bySite(j, s)[0]!.jobId;
  const fixtures: [string, Site, string][] = [
    [
      "hirist-python-bangalore.json",
      "hirist",
      searchUrl(search("hirist", "python developer", [3]), 0),
    ],
    [
      "hirist-python-bangalore-p2.json",
      "hirist",
      searchUrl(search("hirist", "python developer", [3]), 1),
    ],
    [
      "hirist-no-results.json",
      "hirist",
      searchUrl(search("hirist", "zzqxv plorbt"), 0),
    ],
    [
      "hirist-detail.json",
      "hirist",
      detailUrl("hirist", first(desc.out, "hirist")),
    ],
    [
      "iimjobs-marketing.json",
      "iimjobs",
      searchUrl(search("iimjobs", "marketing manager"), 0),
    ],
    [
      "iimjobs-detail.json",
      "iimjobs",
      detailUrl("iimjobs", first(desc.out, "iimjobs")),
    ],
  ];
  for (const [file, site, url] of fixtures) {
    const page = await clients[site].get(url);
    writeFileSync(
      new URL(`../test/fixtures/${file}`, import.meta.url),
      `${slim(page.body)}\n`,
    );
    console.log(`Recorded ${file} from ${url}`);
  }
}

console.log(`\nRequests/blocks: ${requests()}`);
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
