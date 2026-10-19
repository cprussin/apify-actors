/**
 * Live smoke test against real company websites (plain HTTP, no Apify
 * platform). Runs the input-schema prefill (what Apify's daily test runs) and
 * a few German company domains, and prints the hit rate. Domains can be
 * passed as arguments. Prints to stdout only; nothing is saved.
 * Honors HTTPS_PROXY (for sandboxed dev environments).
 * Usage: npm run smoke -w actors/impressum-extractor [-- domain ...]
 */
import { readFileSync } from "node:fs";
import { gotFetch } from "../src/got-fetch.js";
import { HttpClient } from "../src/http.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import { runImprints, type ImprintResult } from "../src/run.js";

const schema = JSON.parse(
  readFileSync(new URL("../.actor/input_schema.json", import.meta.url), "utf8"),
) as { properties: Record<string, { default?: unknown; prefill?: unknown }> };
const defaults = Object.fromEntries(
  Object.entries(schema.properties)
    .filter(([, p]) => p.prefill !== undefined || p.default !== undefined)
    .map(([k, p]) => [k, p.prefill ?? p.default]),
) as RawInput;

const problems: string[] = [];
const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const http = new HttpClient({
  fetch: gotFetch(envProxy ? async () => envProxy : undefined),
  log: console.warn,
});

async function run(name: string, raw: RawInput) {
  const out: ImprintResult[] = [];
  const started = Date.now();
  const stats = await runImprints(normalizeInput(raw), {
    get: (url) => http.get(url),
    log: (m) => console.warn(`${name}: ${m}`),
    emit: async (r) => (out.push(r), true),
  });
  const seconds = (Date.now() - started) / 1000;
  console.log(
    `\n== ${name}: ${stats.charged}/${stats.domains} with register or VAT, ${stats.found} found, in ${seconds}s (${http.requests} requests so far)`,
  );
  for (const r of out)
    console.log(
      `  [${r.domain}] ${r.status} ${r.sourceUrl ?? ""} (${r.pagesFetched} fetches)\n` +
        `    ${r.companyName ?? "-"} | ${r.legalForm ?? "-"} | ${r.address ?? "-"} | ${r.countryGuess ?? "-"}\n` +
        `    ${r.registerCourt ?? "-"} | ${r.registerNumber ?? "-"} | VAT ${r.vatId ?? "-"} | tel ${r.phone ?? "-"} | fax ${r.fax ?? "-"} | ${r.email ?? "-"}` +
        (r.error ? `\n    error: ${r.error.slice(0, 160)}` : ""),
    );
  for (const r of out)
    if (
      r.email &&
      !/^(info|kontakt|contact|office|service|support|hello|mail|presse|press|impressum|legal|team|post|zentrale)/i.test(
        r.email,
      )
    )
      console.log(`  note: role email ${r.email} (check it isn't personal)`);
  return { out, stats, seconds };
}

const d = await run("default", defaults);
if (!d.stats.charged) problems.push("default: no register number or VAT ID");
if (d.seconds > 60) problems.push(`default: took ${d.seconds}s`);

const domains = process.argv.slice(2);
const de = await run("german-companies", {
  domains: domains.length
    ? domains
    : ["t3n.de", "hornbach.de", "ionos.de", "hetzner.com", "jimdo.com"],
});
if (de.stats.charged < Math.ceil(de.stats.domains / 2))
  problems.push(
    `german-companies: only ${de.stats.charged}/${de.stats.domains} with register or VAT`,
  );

console.log(`\n${http.requests} requests total, ${http.blocks} blocked`);
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
