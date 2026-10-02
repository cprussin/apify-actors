/**
 * Live smoke test against Substack's public JSON API.
 * 1. Runs the input-schema default input (what Apify's daily test runs) and
 *    checks it finishes well under 60 s with valid posts.
 * 2. Checks content (free + paid preview), pagination, delta mode, search,
 *    subdomain -> custom domain redirects, post URLs and unknown publications.
 * Usage: npm run smoke -w actors/substack-scraper
 */
import { readFileSync } from "node:fs";
import { HttpClient } from "../src/http.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import type { Post } from "../src/post.js";
import { runScrape } from "../src/run.js";
import { SubstackClient } from "../src/substack.js";

const schema = JSON.parse(
  readFileSync(new URL("../.actor/input_schema.json", import.meta.url), "utf8"),
) as { properties: Record<string, { default?: unknown; prefill?: unknown }> };
const withDefaults = (pick: "prefill" | "default") =>
  Object.fromEntries(
    Object.entries(schema.properties)
      .map(([k, p]) => [k, p[pick] ?? p.default] as const)
      .filter(([, v]) => v !== undefined),
  ) as RawInput;

const problems: string[] = [];
const http = new HttpClient({ log: console.warn });
const client = new SubstackClient(http);

async function run(name: string, raw: RawInput) {
  const out: Post[] = [];
  const started = Date.now();
  const stats = await runScrape(normalizeInput(raw), {
    client,
    log: (m) => problems.push(`${name}: ${m}`),
    emit: async (p) => (out.push(p), true),
  });
  const seconds = (Date.now() - started) / 1000;
  console.log(`\n== ${name}: ${out.length} posts in ${seconds}s`);
  console.log(JSON.stringify(stats.targets));
  for (const p of out) {
    if (
      !p.postId ||
      !p.title ||
      !p.slug ||
      !p.url.startsWith("https://") ||
      Number.isNaN(Date.parse(p.postDate ?? "")) ||
      !["free", "paid"].includes(p.audience) ||
      !p.type
    )
      problems.push(`${name}: bad post ${JSON.stringify(p).slice(0, 500)}`);
  }
  if (new Set(out.map((p) => p.postId)).size !== out.length)
    problems.push(`${name}: duplicate posts`);
  return { out, stats, seconds };
}

// 1. Default input (both the prefill and the schema defaults).
for (const pick of ["prefill", "default"] as const) {
  const input = withDefaults(pick);
  console.log(`Default input (${pick}):`, JSON.stringify(input));
  const d = await run(`default-${pick}`, input);
  const expected =
    Number(input.maxPostsPerPublication) * (input.publications?.length ?? 0);
  if (d.out.length !== expected)
    problems.push(`default-${pick}: ${d.out.length}/${expected} posts`);
  if (!d.out.every((p) => p.publicationName))
    problems.push(`default-${pick}: publicationName missing`);
  if (d.seconds > 30) problems.push(`default-${pick}: took ${d.seconds}s`);
  if (pick === "prefill") console.log(JSON.stringify(d.out[0], null, 2));
}

// 2. Content: free posts complete, paid posts flagged as previews.
const c = await run("content", {
  publications: ["lenny.substack.com"],
  maxPostsPerPublication: 12,
  includeContent: true,
});
const free = c.out.filter((p) => p.audience === "free");
const paid = c.out.filter((p) => p.audience === "paid");
if (!free.length || !paid.length)
  problems.push(`content: want free+paid, got ${free.length}/${paid.length}`);
if (!c.out.every((p) => p.bodyHtml && p.bodyText))
  problems.push("content: missing body");
if (free.some((p) => p.truncated))
  problems.push("content: free post flagged truncated");
if (paid.some((p) => !p.truncated))
  problems.push("content: paid post not flagged truncated");
if (!c.out.every((p) => p.publication === "www.lennysnewsletter.com"))
  problems.push("content: subdomain not resolved to custom domain host");
console.log(
  JSON.stringify(
    paid.slice(0, 1).map((p) => ({
      ...p,
      bodyHtml: p.bodyHtml?.slice(0, 200),
      bodyText: p.bodyText?.slice(0, 300),
    })),
    null,
    2,
  ),
);

// 3. Pagination beyond one page, newest first.
const p = await run("pagination", {
  publications: ["astralcodexten.substack.com"],
  maxPostsPerPublication: 120,
});
if (p.out.length !== 120) problems.push(`pagination: ${p.out.length}/120`);
const dates = p.out.map((x) => x.postDate!);
if (dates.some((d, i) => i > 0 && d > dates[i - 1]!))
  problems.push("pagination: not newest-first");

// 4. Delta mode and search.
const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
const f = await run("delta", {
  publications: ["https://www.lennysnewsletter.com"],
  sinceDate: "60 days",
  maxPostsPerPublication: 500,
});
if (!f.out.length || f.out.some((x) => x.postDate! < since.slice(0, 13)))
  problems.push("delta: filter violated or empty");
if (
  f.stats.targets["https://www.lennysnewsletter.com"]?.status !==
  "reachedSinceDate"
)
  problems.push("delta: did not stop at sinceDate");
const s = await run("search", {
  publications: ["https://www.lennysnewsletter.com"],
  search: "pricing",
  maxPostsPerPublication: 5,
});
if (s.out.length !== 5) problems.push(`search: ${s.out.length}/5`);

// 5. Post URL, unknown publication.
const one = c.out[0]!;
const u = await run("post-url", {
  publications: [one.url, "zzzqqq-nonexistent-pub-12345.substack.com"],
  includeContent: true,
});
if (
  u.out.length !== 1 ||
  u.out[0]!.postId !== one.postId ||
  !u.out[0]!.bodyText
)
  problems.push("post-url: expected the post with content");
if (
  u.stats.targets["https://zzzqqq-nonexistent-pub-12345.substack.com"]
    ?.status !== "notFound"
)
  problems.push("post-url: expected notFound for unknown publication");
problems.splice(
  0,
  problems.length,
  ...problems.filter((m) => !/^post-url: .*not found/.test(m)),
);

console.log(`\n${http.requests} requests total`);
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
