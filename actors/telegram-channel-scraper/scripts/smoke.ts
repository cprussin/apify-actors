/**
 * Live smoke test against t.me.
 * 1. Runs the input-schema default input (what Apify's daily test runs) and
 *    checks it finishes well under 60 s with valid posts and channel info.
 * 2. Checks deep pagination, sinceDate, and error items for bad channels.
 * Usage: npm run smoke -w actors/telegram-channel-scraper
 */
import { readFileSync } from "node:fs";
import { HttpClient } from "../src/http.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import { runChannels } from "../src/run.js";
import type { ChannelInfo, ErrorItem, OutputItem, Post } from "../src/types.js";

const schema = JSON.parse(
  readFileSync(new URL("../.actor/input_schema.json", import.meta.url), "utf8"),
) as { properties: Record<string, { default?: unknown; prefill?: unknown }> };
const defaults = Object.fromEntries(
  Object.entries(schema.properties)
    .filter(([, p]) => p.prefill !== undefined || p.default !== undefined)
    .map(([k, p]) => [k, p.prefill ?? p.default]),
) as RawInput;

const problems: string[] = [];
const http = new HttpClient({ log: console.warn });
const fetchHtml = async (url: string) =>
  (
    await http.request({
      url,
      headers: { "accept-language": "en-US,en;q=0.9" },
    })
  ).text;

async function run(name: string, raw: RawInput) {
  const out: OutputItem[] = [];
  const started = Date.now();
  const stats = await runChannels(normalizeInput(raw), {
    fetchHtml,
    log: (m) => console.warn(`${name}: ${m}`),
    emit: async (item) => (out.push(item), true),
  });
  const seconds = (Date.now() - started) / 1000;
  const posts = out.filter((i): i is Post => i.type === "post");
  const infos = out.filter((i): i is ChannelInfo => i.type === "channel");
  const errors = out.filter((i): i is ErrorItem => i.type === "error");
  console.log(
    `\n== ${name}: ${posts.length} posts, ${infos.length} channel infos, ${errors.length} errors in ${seconds}s`,
  );
  console.log(JSON.stringify(stats.channels));
  for (const p of posts) {
    if (
      !(p.postId > 0) ||
      Number.isNaN(Date.parse(p.date)) ||
      typeof p.text !== "string" ||
      !p.permalink.startsWith("https://t.me/") ||
      (p.views !== null && !(p.views >= 0))
    )
      problems.push(`${name}: bad post ${JSON.stringify(p).slice(0, 300)}`);
  }
  if (
    new Set(posts.map((p) => `${p.channel}/${p.postId}`)).size !== posts.length
  )
    problems.push(`${name}: duplicate posts`);
  return { posts, infos, errors, stats, seconds };
}

// 1. Default input.
console.log("Default input:", JSON.stringify(defaults));
const d = await run("default", defaults);
console.log(JSON.stringify(d.infos[0], null, 2));
console.log(JSON.stringify(d.posts[0], null, 2));
const perChannel = Number(defaults.maxPostsPerChannel);
for (const ch of ["durov", "telegram"]) {
  const n = d.posts.filter((p) => p.channel === ch).length;
  if (n !== perChannel)
    problems.push(`default: ${ch} ${n}/${perChannel} posts`);
  const info = d.infos.find((i) => i.channel === ch);
  if (!info?.title || !(info.subscribers! > 1_000_000))
    problems.push(`default: ${ch} channel info ${JSON.stringify(info)}`);
}
if (!d.posts.some((p) => p.views && p.reactions.length))
  problems.push("default: no views/reactions");
if (!d.posts.some((p) => p.media.length)) problems.push("default: no media");
if (d.errors.length)
  problems.push(`default: errors ${JSON.stringify(d.errors)}`);
if (d.seconds > 30) problems.push(`default: took ${d.seconds}s`);

// 2. Deep pagination, newest first.
const p = await run("pagination", {
  channels: ["https://t.me/s/nytimes"],
  maxPostsPerChannel: 120,
  includeChannelInfo: false,
});
const ids = p.posts.map((x) => x.postId);
if (ids.length !== 120) problems.push(`pagination: ${ids.length}/120`);
if (ids.some((id, i) => i > 0 && id >= ids[i - 1]!))
  problems.push("pagination: not strictly newest-first");

// 3. sinceDate.
// breakingmash posts many times per hour.
const since = new Date(Date.now() - 12 * 3_600_000).toISOString();
const s = await run("since", {
  channels: ["breakingmash"],
  sinceDate: "12 hours",
  maxPostsPerChannel: 1000,
  includeChannelInfo: false,
});
if (s.posts.some((x) => x.date < since.slice(0, 16)))
  problems.push("since: older post returned");
if (!s.posts.length) problems.push("since: no posts");
if (s.stats.channels.breakingmash?.status !== "reachedSinceDate")
  problems.push(`since: status ${s.stats.channels.breakingmash?.status}`);

// 4. Error items.
const bad = await run("errors", {
  channels: [
    "zzqqxxnonexist12345",
    "wallstreetbets",
    "botfather",
    "https://t.me/+abc",
  ],
});
const codes = bad.errors.map((e) => e.errorCode);
if (
  JSON.stringify(codes) !==
  JSON.stringify(["notFound", "notAChannel", "notAChannel", "invalidInput"])
)
  problems.push(`errors: got ${JSON.stringify(codes)}`);
if (bad.posts.length || bad.infos.length)
  problems.push("errors: unexpected data");

console.log(`\n${http.requests} requests total`);
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
