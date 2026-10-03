/**
 * Live smoke test against ycombinator.com and its Algolia index (no proxy,
 * no Apify platform).
 * 1. Runs the input-schema default input (what Apify's daily test runs).
 * 2. Companies in batch "Summer 2025", jobs for one role, remote jobs, a
 *    company jobs page, and a run past Algolia's 1,000-hit limit.
 * Usage: npm run smoke -w actors/ycombinator-companies [-- --record]
 * --record saves the responses used by the tests to test/fixtures/.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { AlgoliaSearch } from "../src/algolia.js";
import { gotFetch } from "../src/got-fetch.js";
import { YcClient } from "../src/http.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import {
  run,
  type CompanyResult,
  type Item,
  type JobResult,
} from "../src/run.js";
import { DIRECTORY_URL, extractAlgoliaOpts } from "../src/yc.js";

const record = process.argv.includes("--record");
const fixtures = new URL("../test/fixtures/", import.meta.url);
// Drop short-lived pre-signed S3 query strings (temporary AWS credentials).
const scrub = (body: string) =>
  body.replace(/\?X-Amz-[^"\s]*?(?=&quot;|"|\s)/g, "");
const save = (name: string, body: string) => {
  if (record) writeFileSync(new URL(name, fixtures), scrub(body));
};

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
const http = new YcClient({ fetch: gotFetch(), log: console.warn });
const api = new YcClient({ log: console.warn });

const PAGE_FIXTURES: Record<string, string> = {
  [DIRECTORY_URL]: "companies.html",
  "https://www.ycombinator.com/jobs/role/software-engineer":
    "jobs-software-engineer.html",
  "https://www.ycombinator.com/jobs/role/product-manager/remote":
    "jobs-product-manager-remote.html",
};
let algoliaCalls = 0;
let algolia: AlgoliaSearch | undefined;
const deps = {
  get: async (url: string) => {
    const page = await http.get(url);
    const name = PAGE_FIXTURES[url];
    if (name) save(name, page.html);
    return page;
  },
  algolia: async () => {
    if (algolia) return algolia;
    const page = await deps.get(DIRECTORY_URL);
    const opts = extractAlgoliaOpts(page.html);
    if (!opts) throw new Error("No Algolia key on the directory page");
    algolia = new AlgoliaSearch(opts, async (url, body, headers) => {
      const res = await api.post(url, body, headers);
      algoliaCalls += 1;
      const params = (JSON.parse(body) as { requests: { params: string }[] })
        .requests[0]!.params;
      if (params.includes("Summer+2025") && params.includes("hitsPerPage=20&"))
        save("algolia-summer-2025.json", res.html);
      return res;
    });
    return algolia;
  },
};

async function go(name: string, raw: RawInput) {
  const out: Item[] = [];
  const started = Date.now();
  const input = normalizeInput(raw);
  const stats = await run(input, {
    ...deps,
    log: (m) => console.warn(`  ${name}: ${m}`),
    emit: async (r) => (out.push(r), true),
  });
  const seconds = (Date.now() - started) / 1000;
  console.log(
    `\n== ${name}: ${out.length} items in ${seconds}s (${stats.totalMatches ?? "-"} matches, ${http.requests} page requests, ${algoliaCalls} Algolia calls)`,
  );
  for (const s of stats.sources)
    console.log(
      `  [${s.source}] ${s.status}: ${s.items}${s.error ? ` ${s.error}` : ""}`,
    );
  if (
    new Set(out.map((i) => ("jobId" in i ? i.jobId : i.companyId))).size !==
    out.length
  )
    problems.push(`${name}: duplicates`);
  if (!out.length) problems.push(`${name}: no results`);
  return { out, stats, seconds, input };
}

function checkCompanies(name: string, out: Item[]) {
  const cs = out as CompanyResult[];
  for (const c of cs.slice(0, 3))
    console.log(
      `  ${c.name} (${c.batchCode}, ${c.status}, ${c.teamSize ?? "?"} people) ${c.industries.join("/")} ${c.website} hiring=${c.isHiring} ${c.ycUrl}`,
    );
  for (const c of cs)
    if (!c.name || !c.slug || !c.ycUrl || !c.batch || !c.oneLiner)
      problems.push(`${name}: incomplete company ${c.companyId}`);
  return cs;
}

function checkJobs(name: string, out: Item[]) {
  const js = out as JobResult[];
  for (const j of js.slice(0, 3))
    console.log(
      `  ${j.title} @ ${j.companyName} (${j.companyBatch}) ${j.location}${j.remote ? " [remote]" : ""} ${j.salaryMin ?? "?"}-${j.salaryMax ?? "?"} ${j.salaryCurrency ?? ""} eq ${j.equityMin ?? "?"}-${j.equityMax ?? "?"}% exp ${j.minExperienceYears ?? "?"} ${j.jobUrl}`,
    );
  for (const j of js)
    if (!j.title || !j.companyName || !j.jobUrl || !j.companyUrl)
      problems.push(`${name}: incomplete job ${j.jobId}`);
  const salaried = js.filter((j) => j.salaryMax !== null).length;
  console.log(`  ${salaried}/${js.length} with salary`);
  if (js.length && salaried < js.length / 3)
    problems.push(`${name}: only ${salaried}/${js.length} with salary`);
  return js;
}

// 1. Default input.
console.log("Default input:", JSON.stringify(defaults));
const d = await go("default", defaults);
if (d.out.length !== d.input.maxItems)
  problems.push(`default: ${d.out.length}/${d.input.maxItems} items`);
if (d.seconds > 30) problems.push(`default: took ${d.seconds}s`);

// 2. Summer 2025 companies.
const s25 = await go("companies S25", {
  mode: "companies",
  batches: ["Summer 2025"],
  maxItems: 20,
});
const cs = checkCompanies("companies S25", s25.out);
if (cs.length !== 20) problems.push(`companies S25: ${cs.length}/20`);
if (cs.some((c) => c.batch !== "Summer 2025"))
  problems.push("companies S25: wrong batch");
if (record) {
  // Facet lookup fixture (the filter run above made this request).
  const a = await deps.algolia();
  const res = await a.search({
    hitsPerPage: 0,
    facets: ["batch", "industries", "regions", "tags"],
    attributesToRetrieve: [],
  });
  save("algolia-facets.json", JSON.stringify({ results: [res] }));
}

// 3. Jobs for one role.
const jobs = await go("jobs software-engineer", {
  mode: "jobs",
  jobRoles: ["software-engineer"],
  maxItems: 10,
});
const js = checkJobs("jobs software-engineer", jobs.out);
if (js.length !== 10) problems.push(`jobs: ${js.length}/10`);

// 4. Remote role page + a company's jobs page.
const remote = await go("jobs remote + company", {
  mode: "jobs",
  jobRoles: ["Product Manager"],
  jobLocation: "remote",
  companySlugs: [js[0]!.companySlug!],
  maxItems: 200,
});
checkJobs("jobs remote + company", remote.out);
if (remote.stats.sources.some((s) => s.status !== "done"))
  problems.push("jobs remote + company: a page did not finish");
if (record) {
  const url = `https://www.ycombinator.com/companies/${js[0]!.companySlug}/jobs`;
  save("company-jobs.html", (await http.get(url)).html);
}

// 5. Unknown role slug pages fall back to software engineer: detected.
const bogus = await run(
  normalizeInput({ mode: "jobs", jobLocation: "atlantis" }),
  {
    ...deps,
    emit: async () => true,
  },
).catch((e: Error) => e);
if (!(bogus instanceof Error) || !/location/.test(bogus.message))
  problems.push("bogus location: not detected");

// 6. Past Algolia's 1,000-hit limit (no filters, newest first).
const big = await go("companies 1100", {
  mode: "companies",
  sortBy: "launchDate",
  maxItems: 1100,
});
if (big.out.length !== 1100) problems.push(`big: ${big.out.length}/1100`);

console.log(`\n${http.requests} page requests, ${algoliaCalls} Algolia calls`);
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
