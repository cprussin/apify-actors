/**
 * Live smoke test against SEC EDGAR.
 * 1. The Store prefill input (last 5 days, no investment funds, 20 results).
 * 2. A larger unfiltered pull to measure throughput.
 * Usage: npm run smoke -w actors/sec-form-d-funding [-- <maxResults>]
 */
import { readFileSync } from "node:fs";
import { EdgarClient } from "../src/edgar.js";
import type { FilingRecord } from "../src/formd.js";
import { computeWindow, normalizeInput, type RawInput } from "../src/input.js";
import { runFeed } from "../src/run.js";

const schema = JSON.parse(
  readFileSync(new URL("../.actor/input_schema.json", import.meta.url), "utf8"),
) as { properties: Record<string, { prefill?: unknown }> };
const prefill = Object.fromEntries(
  Object.entries(schema.properties)
    .filter(([, p]) => p.prefill !== undefined)
    .map(([k, p]) => [k, p.prefill]),
) as RawInput;

const problems: string[] = [];

async function run(label: string, raw: RawInput) {
  const input = normalizeInput(raw);
  const window = computeWindow(input, new Date());
  const client = new EdgarClient({
    userAgent: process.env.SEC_USER_AGENT,
    log: console.warn,
  });
  const out: FilingRecord[] = [];
  const started = Date.now();
  const stats = await runFeed(input, window, {
    client,
    log: console.warn,
    emit: async (r) => (out.push(r), true),
  });
  const seconds = (Date.now() - started) / 1000;
  console.log(label, {
    input: raw,
    window,
    stats,
    requests: client.requests,
    seconds,
    secondsPerFiling: out.length ? seconds / out.length : null,
  });
  if (!out.length) problems.push(`${label}: no filings`);
  for (const r of out) {
    if (
      !r.issuerName ||
      !r.cik ||
      !/^\d{10}-\d{2}-\d{6}$/.test(r.accessionNumber) ||
      !r.filingDate ||
      r.filingDate < window.from ||
      r.filingDate > window.to ||
      !r.exemptions.length ||
      !r.industryGroup
    )
      problems.push(`${label}: bad record ${JSON.stringify(r)}`);
    if (
      input.excludeInvestmentFunds &&
      r.industryGroup === "Pooled Investment Fund"
    )
      problems.push(`${label}: fund not excluded ${r.accessionNumber}`);
  }
  return out;
}

const pre = await run("prefill", prefill);
console.log(JSON.stringify(pre.slice(0, 3), null, 2));
const max = Number(process.argv[2] ?? 100);
const all = await run("bulk", { lastNDays: 7, maxResults: max });
const share = (f: (r: FilingRecord) => boolean) =>
  `${Math.round((100 * all.filter(f).length) / all.length)}%`;
console.log("bulk field coverage", {
  amendments: share((r) => r.isAmendment),
  funds: share((r) => r.industryGroup === "Pooled Investment Fund"),
  offeringAmount: share((r) => r.totalOfferingAmount !== null),
  indefinite: share((r) => r.offeringAmountIndefinite),
  relatedPersons: share((r) => r.relatedPersons.length > 0),
  phone: share((r) => !!r.phone),
});

if (problems.length) {
  console.error("SMOKE FAILED", problems.slice(0, 20));
  process.exit(1);
}
console.log("SMOKE OK");
