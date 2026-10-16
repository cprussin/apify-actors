/**
 * Live smoke test against cutshort.io (no proxy, no Apify platform).
 * 1. Runs the input-schema default input (what Apify's daily test runs) and
 *    checks it finishes quickly with complete jobs.
 * 2. Checks paging, skill-name resolution, remote, job details, sitemap
 *    mode and monitor mode (new / unchanged / updated / removed).
 * With --record, saves trimmed responses used by the tests to test/fixtures.
 * Usage: npm run smoke -w actors/cutshort-jobs [-- --record]
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  jobPageUrl,
  listingDataUrl,
  nextData,
  SITEMAP_URL,
  type RawJob,
} from "../src/cutshort.js";
import { gotFetch } from "../src/got-fetch.js";
import { CutshortClient } from "../src/http.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import { Monitor } from "../src/monitor.js";
import { runJobs, type ChargeEvent, type JobResult } from "../src/run.js";

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
// Local sandboxes may only reach the web through HTTPS_PROXY.
const envProxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
const http = new CutshortClient({
  fetch: gotFetch(envProxy ? async () => envProxy : undefined),
  minIntervalMs: 1000,
  log: console.warn,
});

async function run(name: string, raw: RawInput, monitor?: Monitor) {
  const out: JobResult[] = [];
  const charges: Record<ChargeEvent, number> = { job: 0, "job-detail": 0 };
  const started = Date.now();
  const input = normalizeInput(raw);
  const stats = await runJobs(input, {
    get: (url, expect) => http.get(url, expect),
    log: (m) => problems.push(`${name}: ${m}`),
    monitor,
    emit: async (r, events) => {
      out.push(r);
      for (const e of events) charges[e] += 1;
      return true;
    },
  });
  const seconds = (Date.now() - started) / 1000;
  console.log(
    `\n== ${name}: ${out.length} jobs from ${stats.pages} pages in ${seconds}s (${http.requests} requests so far, ${http.blocks} blocks), charges ${JSON.stringify(charges)}`,
  );
  for (const s of stats.searches)
    console.log(
      `  [${s.search}] ${s.status} ${s.slug ?? ""}: ${s.jobs} jobs, ${s.pages} pages, ${s.liveJobs} live`,
    );
  if (monitor)
    console.log(
      `  monitor: ${stats.new} new, ${stats.updated} updated, ${stats.removed} removed, ${stats.unchanged} unchanged${stats.removedSkipped ? ` (removed skipped: ${stats.removedSkipped})` : ""}`,
    );
  for (const j of out.slice(0, 3))
    console.log(
      `  ${j.changeType ?? ""} ${j.headline} @ ${j.companyName} [${j.locations.join("/")}] ${j.experienceMin ?? "?"}-${j.experienceMax ?? "?"}y ${j.salaryMin ?? "?"}-${j.salaryMax ?? "?"} ${j.salaryCurrency ?? ""} ${j.postedAt?.slice(0, 10)} ${j.url}`,
    );
  const live = out.filter((j) => j.changeType !== "removed");
  for (const j of live) {
    if (!j.headline || !j.url || !j.companyName)
      problems.push(`${name}: incomplete item ${j.jobId}`);
    if (!j.postedAt) problems.push(`${name}: no postedAt ${j.jobId}`);
    if (j.experienceMin === null)
      problems.push(`${name}: no experience ${j.jobId}`);
  }
  const skilled = live.filter((j) => j.skills.length).length;
  const paid = live.filter((j) => j.salaryMax !== null).length;
  console.log(`  ${skilled}/${live.length} with skills, ${paid} with salary`);
  if (live.length && skilled < live.length / 2)
    problems.push(`${name}: only ${skilled}/${live.length} with skills`);
  if (live.length && paid < live.length / 3)
    problems.push(`${name}: only ${paid}/${live.length} with salary`);
  if (new Set(out.map((j) => j.jobId)).size !== out.length)
    problems.push(`${name}: duplicate jobs`);
  return { out, stats, seconds, input, charges };
}

// 1. Default input.
console.log("Default input:", JSON.stringify(defaults));
const d = await run("default", defaults);
if (d.out.length !== d.input.maxItems)
  problems.push(`default: ${d.out.length}/${d.input.maxItems} jobs`);
if (d.seconds > 30) problems.push(`default: took ${d.seconds}s`);
if (d.charges["job-detail"]) problems.push("default: charged job-detail");
console.log("\nSample:", JSON.stringify(d.out[0], null, 2));

// 2. Two pages, skill given by name.
const p = await run("pages", {
  skills: ["React.js"],
  maxPages: 2,
  maxItems: 80,
});
if (p.stats.searches[0]?.slug !== "reactjs-jobs")
  problems.push("pages: React.js not resolved to reactjs-jobs");
if (p.out.length !== 80) problems.push(`pages: ${p.out.length}/80 jobs`);

// 3. Name needing the second candidate, remote, and details.
const det = await run("details", {
  skills: ["Data Science"],
  cities: ["Remote"],
  maxItems: 3,
  includeDetails: true,
});
if (det.stats.searches[0]?.slug !== "remote-datascience-jobs")
  problems.push("details: Data Science/Remote not resolved");
if (det.out.some((j) => !j.description || j.jobValid !== true))
  problems.push("details: description/jobValid missing");
if (det.charges["job-detail"] !== det.out.length)
  problems.push("details: job-detail charges");
console.log("\nDetail sample:", JSON.stringify(det.out[0], null, 2));

// 4. Unknown skill.
const unk = await run("unknown", { skills: ["zzqxv plorbt"], maxItems: 5 });
if (unk.stats.searches[0]?.status !== "notFound")
  problems.push("unknown: expected notFound");
problems.splice(
  0,
  problems.length,
  ...problems.filter((m) => !/^unknown: zzqxv/.test(m)),
);

// 5. Sitemap mode (all jobs).
const sm = await run("sitemap", { skills: [], maxItems: 3 });
if (sm.out.length !== 3) problems.push(`sitemap: ${sm.out.length}/3 jobs`);
if (sm.charges["job-detail"] !== 3)
  problems.push("sitemap: job-detail charges");

// 6. Monitor mode on a small listing, read to the end.
const mon = new Monitor();
const monInput: RawInput = {
  skills: ["golang"],
  cities: ["pune"],
  maxItems: 1000,
  monitorMode: true,
};
const m1 = await run("monitor-1", monInput, mon);
if (!m1.out.length || m1.out.some((j) => j.changeType !== "new"))
  problems.push("monitor-1: expected only new jobs");
if (m1.stats.removedSkipped) problems.push("monitor-1: crawl not complete");
// Simulate: one job changed, one disappeared, one removed since last run.
const state = mon.toJSON();
const [changed, forgotten] = state.items;
if (changed) changed[1] = "different";
state.items = state.items.filter((e) => e !== forgotten);
state.items.push([
  "ZZZZZZZZ",
  "x",
  "Gone job",
  "Gone Inc",
  "https://cutshort.io/job/Gone-ZZZZZZZZ",
]);
const m2 = await run("monitor-2", monInput, new Monitor(state));
const kinds = m2.out.map((j) => `${j.changeType}:${j.jobId}`).sort();
console.log("  changes:", kinds.join(", "));
if (m2.stats.new !== 1 || m2.stats.updated !== 1 || m2.stats.removed !== 1)
  problems.push(
    `monitor-2: expected 1 new/1 updated/1 removed, got ${kinds.join(", ")}`,
  );

if (process.argv.includes("--record")) {
  const dir = new URL("../test/fixtures/", import.meta.url);
  const save = (file: string, body: string) => {
    writeFileSync(new URL(file, dir), body);
    console.log(`Recorded ${file} (${body.length} bytes)`);
  };
  // Drop personal data (recruiters, team members) and bulky company fields.
  const slimJob = (j: RawJob & Record<string, unknown>) => {
    const { createdBy: _c, relatedHubLinks: _r, ...rest } = j;
    const cd = rest.companyDetails as Record<string, unknown> | undefined;
    if (cd)
      rest.companyDetails = Object.fromEntries(
        Object.entries(cd).filter(
          ([k]) =>
            ![
              "description",
              "sanitizedDescription",
              "highlightTeamMembers",
              "photos",
              "productShowcase",
              "companyFAQs",
              "techStack",
              "company",
            ].includes(k),
        ),
      );
    return rest;
  };
  // Listing: a mix of shapes (client hiring, monthly/no salary, remote).
  const page = await http.get(listingDataUrl("python-jobs-in-pune", 1), "json");
  const json = JSON.parse(page.body) as {
    data: {
      pageData: { jobs: (RawJob & Record<string, unknown>)[] };
      seoData: unknown;
    };
  };
  const jobs = json.data.pageData.jobs;
  const pick = [
    jobs.find((j) => !j.hiringForClient && j.remoteType === "remote_not_okay"),
    jobs.find((j) => j.hiringForClient),
    jobs.find((j) => j.remoteType !== "remote_not_okay"),
    jobs.find(
      (j) =>
        typeof j.salaryRange === "object" && !(j.salaryRange?.maxVanity ?? 0),
    ),
  ].filter((j, i, a): j is NonNullable<typeof j> => !!j && a.indexOf(j) === i);
  pick.push(jobs[0]!, jobs[0]!); // a duplicate within the page
  json.data.pageData = {
    ...json.data.pageData,
    jobs: pick.map(slimJob),
    sideJobLinks: undefined,
    breadcrumbs: undefined,
  } as typeof json.data.pageData;
  json.data.seoData = undefined;
  save("listing-python-pune.json", `${JSON.stringify(json)}\n`);
  for (const [file, slug, n] of [
    ["listing-end.json", "python-jobs-in-pune", 200],
    ["listing-unknown.json", "zzqxv-jobs", 1],
  ] as const) {
    const r = await http.get(listingDataUrl(slug, n), "json");
    save(file, r.body.endsWith("\n") ? r.body : `${r.body}\n`);
  }
  // Job page: only __NEXT_DATA__, with the jobData query slimmed.
  const slimDetail = (html: string) => {
    const nd = nextData(html) as {
      props: {
        pageProps: {
          dehydratedState: {
            queries: {
              queryKey: unknown[];
              state: {
                data: {
                  data: {
                    pageData: RawJob & Record<string, unknown>;
                    seoData: { jsonlds: unknown[] };
                  };
                };
              };
            }[];
          };
        };
      };
    };
    const qs = nd.props.pageProps.dehydratedState.queries.filter(
      (q) => q.queryKey[0] === "jobData",
    );
    for (const q of qs) {
      const data = q.state.data.data;
      const { breadcrumbs: _b, ...pd } = slimJob(data.pageData);
      data.pageData = pd as typeof data.pageData;
      data.seoData = {
        jsonlds: data.seoData.jsonlds.filter(
          (x) => (x as { "@type"?: string })["@type"] === "JobPosting",
        ),
      };
    }
    nd.props.pageProps.dehydratedState.queries = qs;
    return `<!DOCTYPE html><html><head><title>Cutshort</title></head><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nd).replace(/<\//g, "<\\/")}</script></body></html>\n`;
  };
  const detailUrl =
    d.out.find((j) => j.locations.length > 1)?.url ?? d.out[0]!.url!;
  const dp = await http.get(jobPageUrl(detailUrl), "html");
  save("job-page.html", slimDetail(dp.body));
  console.log(`  job page from ${detailUrl}`);
  const gone = await http.get(jobPageUrl("Nonexistent-Job-xxxxxxxx"), "html");
  console.log(`  missing job page: HTTP ${gone.status}`);
  const nd404 = (nextData(gone.body) ?? {}) as {
    props?: { pageProps?: { dehydratedState?: { queries?: unknown[] } } };
  };
  const q404 = nd404.props?.pageProps?.dehydratedState;
  if (q404) q404.queries = [];
  save(
    "job-gone.html",
    `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nd404).replace(/<\//g, "<\\/")}</script></body></html>\n`,
  );
  const sitemap = await http.get(SITEMAP_URL, "xml");
  const urls = sitemap.body.match(/<url>[\s\S]*?<\/url>/g) ?? [];
  const head = sitemap.body.slice(0, sitemap.body.indexOf("<url>"));
  save(
    "sitemap-jobs.xml",
    `${head}${urls.slice(0, 5).join("\n")}\n</urlset>\n`,
  );
}

console.log(`\n${http.requests} requests total, ${http.blocks} blocked`);
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
