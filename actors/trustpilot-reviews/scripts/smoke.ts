/**
 * Live smoke test against trustpilot.com (no Apify platform involved).
 * 1. Default input: must return reviews in well under 60 s.
 * 2. Filters + delta mode + a URL input + an unknown company.
 * Usage: npm run smoke -w actors/trustpilot-reviews
 */
import { TrustpilotClient } from "../src/client.js";
import { makeHttp, USER_AGENT } from "../src/http.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import type { ReviewRecord } from "../src/record.js";
import { runScrape } from "../src/run.js";
import { browserTokenSolver } from "../src/waf.js";

const problems: string[] = [];
const http = makeHttp();

const client = new TrustpilotClient({
  fetch: http.fetch,
  userAgent: USER_AGENT,
  solveToken: browserTokenSolver({
    userAgent: USER_AGENT,
    rawFetch: http.raw,
    log: console.log,
  }),
  log: console.warn,
});

async function run(raw: RawInput) {
  const input = normalizeInput(raw);
  const out: ReviewRecord[] = [];
  const started = Date.now();
  const stats = await runScrape(input, {
    client,
    log: console.warn,
    emit: async (r) => (out.push(r), true),
  });
  const seconds = (Date.now() - started) / 1000;
  console.log(JSON.stringify({ raw, stats, seconds }));
  return { input, out, stats, seconds };
}

const check = (r: ReviewRecord, label: string) => {
  if (
    !r.reviewId ||
    !r.companyDomain ||
    !r.companyName ||
    r.trustScore === null ||
    !r.totalReviews ||
    !r.rating ||
    !r.date ||
    !r.url.includes(r.reviewId)
  )
    problems.push(`${label}: bad record ${JSON.stringify(r).slice(0, 300)}`);
};

// 1. Default input (what Apify's daily health check runs).
const d = await run({});
console.log(JSON.stringify(d.out.slice(0, 2), null, 2));
if (d.out.length < 5) problems.push(`default: only ${d.out.length} reviews`);
if (d.seconds > 45) problems.push(`default: took ${d.seconds}s`);
if (!d.out[0]?.company?.profileUrl) problems.push("default: no company info");
d.out.forEach((r) => check(r, "default"));
for (let i = 1; i < d.out.length; i++)
  if (d.out[i]!.date! > d.out[i - 1]!.date!)
    problems.push("default: not sorted by date");

// 2. Filters, delta mode, URL input, unknown company.
const since = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10);
const f = await run({
  companies: [
    "https://www.trustpilot.com/review/www.gymshark.com",
    "no-such-company-xyz-4821.com",
  ],
  maxReviewsPerCompany: 30,
  stars: ["1", "2"],
  sinceDate: since,
  includeCompanyInfo: false,
});
if (!f.out.length) problems.push("filters: no reviews");
f.out.forEach((r) => check(r, "filters"));
if (f.out.some((r) => r.rating! > 2)) problems.push("filters: star filter");
if (f.out.some((r) => r.date! < since)) problems.push("filters: sinceDate");
if (f.out.some((r) => r.company)) problems.push("filters: company info");
if (f.stats.companies["no-such-company-xyz-4821.com"]?.status !== "notFound")
  problems.push("filters: unknown company not reported as notFound");

// 3. Past the 200-per-filter cap (split by star rating, merged by date).
const s = await run({ companies: ["gymshark.com"], maxReviewsPerCompany: 230 });
if (s.out.length !== 230) problems.push(`split: got ${s.out.length}/230`);
if (new Set(s.out.map((r) => r.reviewId)).size !== s.out.length)
  problems.push("split: duplicate reviews");
for (let i = 1; i < s.out.length; i++)
  if (s.out[i]!.date! > s.out[i - 1]!.date!)
    problems.push(`split: not sorted by date at ${i}`);

console.log({ requests: client.requests, verifications: client.solves });
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
