/**
 * Live smoke test against the real boards (plain HTTP, no Apify platform).
 * Runs the input-schema defaults (what Apify's daily test runs) and checks
 * each board returned rows, then forces the douyin.com fallback.
 * Prints to stdout only; nothing is saved.
 * Honors HTTPS_PROXY (for sandboxed dev environments).
 * Usage: npm run smoke -w actors/china-hot-search
 */
import { readFileSync } from "node:fs";
import { gotFetch } from "../src/got-fetch.js";
import { HttpClient, HttpError } from "../src/http.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import { runBoards, URLS, type RunDeps, type TrendItem } from "../src/run.js";

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

async function run(name: string, raw: RawInput, get: RunDeps["get"]) {
  const out: TrendItem[] = [];
  const started = Date.now();
  const stats = await runBoards(normalizeInput(raw), {
    get,
    log: (m) => console.warn(`${name}: ${m}`),
    emit: async (r) => (out.push(r), true),
  });
  const seconds = (Date.now() - started) / 1000;
  console.log(`\n== ${name}: ${stats.items} rows in ${seconds}s`);
  for (const p of stats.platforms) {
    const rows = out.filter((r) => r.platform === p.platform);
    const labelled = rows.filter((r) => r.label).length;
    const hot = rows.filter((r) => r.hotValue !== null).length;
    console.log(
      `  [${p.platform}] ${p.status} ${p.items} rows (${hot} with hotValue, ${labelled} labelled) from ${p.source ?? "-"}` +
        (p.error ? `\n    error: ${p.error.slice(0, 200)}` : ""),
    );
    for (const r of rows.slice(0, 3))
      console.log(
        `    #${r.rank} ${r.title} | ${r.hotValue ?? "-"} | ${r.label ?? "-"}/${r.labelEn ?? "-"} | ${r.url.slice(0, 90)}`,
      );
    if (p.status === "ok" && rows.some((r) => !r.title || !r.url))
      problems.push(`${name}/${p.platform}: row without title or url`);
  }
  return { stats, seconds };
}

const d = await run("default", defaults, (u, h) => http.get(u, h));
for (const p of d.stats.platforms)
  if (p.items < 5) problems.push(`default/${p.platform}: ${p.status}`);
if (d.seconds > 60) problems.push(`default: took ${d.seconds}s`);

// Same run with the billboard API failing, to exercise the douyin.com board.
const fb = await run("douyin-fallback", { platforms: ["douyin"] }, (u, h) =>
  u === URLS.douyinBillboard
    ? Promise.reject(new HttpError(403, "forced by smoke test", u))
    : http.get(u, h),
);
if ((fb.stats.platforms[0]?.items ?? 0) < 5)
  problems.push(`douyin-fallback: ${fb.stats.platforms[0]?.status}`);

console.log(`\n${http.requests} requests total, ${http.blocks} blocked`);
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
