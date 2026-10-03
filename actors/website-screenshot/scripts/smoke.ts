/**
 * Live smoke test with a real browser (no Apify platform involved).
 * Captures the default input, a full-page JPEG, a mobile WebP, a PDF and an
 * unreachable URL, and checks the files and dataset items.
 * Usage: npm run smoke -w actors/website-screenshot [-- <outDir>]
 * Uses HTTPS_PROXY for the browser when set.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { capturePage, launchBrowser } from "../src/browser.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import { imageSize } from "../src/keys.js";
import { runScreenshots, type ScreenshotResult } from "../src/run.js";

const outDir = resolve(process.argv[2] ?? "storage/smoke");
mkdirSync(outDir, { recursive: true });
const problems: string[] = [];
const warnings: string[] = [];
const browser = await launchBrowser(
  process.env.HTTPS_PROXY ?? process.env.https_proxy,
);
console.log(`Chromium ${browser.version()}, files in ${outDir}`);

async function run(raw: RawInput) {
  const input = normalizeInput(raw);
  const out: ScreenshotResult[] = [];
  const started = Date.now();
  const stats = await runScreenshots(input, {
    capture: (url, w) =>
      capturePage(browser, url, w, input, (m) => {
        warnings.push(m);
        console.warn(m);
      }),
    save: async (key, body) => {
      writeFileSync(join(outDir, key), body);
      return `file://${join(outDir, key)}`;
    },
    emit: async (item) => {
      out.push(item);
      return { pushed: true, more: true };
    },
    log: console.warn,
  });
  const seconds = (Date.now() - started) / 1000;
  for (const item of out) console.log(JSON.stringify(item));
  console.log(JSON.stringify({ stats, seconds }));
  return { out, stats, seconds };
}

// 1. Default input (what Apify's daily health check runs).
const d = await run({});
const def = d.out[0];
if (!def || def.error) problems.push(`default: ${def?.error ?? "no item"}`);
else if (def.width !== 1920 || def.height !== 1080)
  problems.push(`default: size ${def.width}x${def.height}`);
if (d.seconds > 30) problems.push(`default: took ${d.seconds}s`);

// 2. Full-page JPEG with lazy content, a mobile WebP, a PDF and a dead URL.
const full = await run({
  urls: ["https://en.wikipedia.org/wiki/Web_scraping"],
  format: "jpeg",
  fullPage: true,
  scrollToBottom: true,
});
const f = full.out[0];
if (!f || f.error) problems.push(`fullPage: ${f?.error ?? "no item"}`);
else if ((f.height ?? 0) <= 1080) problems.push(`fullPage: height ${f.height}`);
if (warnings.length) problems.push(`warnings: ${warnings.join("; ")}`);

const mobile = await run({
  urls: ["https://example.com"],
  format: "webp",
  device: "mobile",
});
const m = mobile.out[0];
if (!m || m.error) problems.push(`webp: ${m?.error ?? "no item"}`);
else if (m.format !== "webp" || m.width !== 780)
  problems.push(`webp: ${m.format} ${m.width}x${m.height}`);

const pdf = await run({
  urls: ["https://news.ycombinator.com", "https://no-such-host.invalid"],
  format: "pdf",
  fullPage: true,
  timeoutSecs: 20,
});
const [p, dead] = pdf.out.sort((a, b) => a.url.localeCompare(b.url));
if (!p || p.error || p.format !== "pdf" || !p.bytes)
  problems.push(`pdf: ${p?.error ?? "bad item"}`);
if (!dead?.error || dead.screenshotUrl) problems.push("dead URL: no error");

// Sanity check a saved file against its item.
if (def?.screenshotKey) {
  const size = imageSize(readFileSync(join(outDir, def.screenshotKey)));
  if (size?.width !== def.width) problems.push("default: file size mismatch");
}

await browser.close();
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
