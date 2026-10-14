/**
 * Live smoke test against SoundCloud's public api-v2 (no Apify platform needed).
 * 1. Extracts a client_id from the homepage JS bundles.
 * 2. Runs the input-schema prefill input (what Apify's daily test runs) and
 *    checks it returns the expected tracks/user with real metadata.
 * 3. Checks keyword search (tracks, users, playlists) and an unknown URL.
 *
 * Set SMOKE_PROXY_URL=http://user:pass@host:port to route through a proxy.
 * Usage: npm run smoke -w actors/soundcloud-metadata
 */
import { readFileSync } from "node:fs";
import { ClientIdProvider } from "../src/client-id.js";
import { HttpClient } from "../src/http.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import type { Item } from "../src/item.js";
import { proxiedFetch } from "../src/proxy-fetch.js";
import { runScrape } from "../src/run.js";
import { SoundCloudClient } from "../src/soundcloud.js";

const schema = JSON.parse(
  readFileSync(new URL("../.actor/input_schema.json", import.meta.url), "utf8"),
) as { properties: Record<string, { default?: unknown; prefill?: unknown }> };
const prefill = Object.fromEntries(
  Object.entries(schema.properties)
    .map(([k, p]) => [k, p.prefill ?? p.default] as const)
    .filter(([, v]) => v !== undefined),
) as RawInput;

const proxyUrl = process.env.SMOKE_PROXY_URL;
const http = new HttpClient({
  fetch: proxyUrl ? proxiedFetch(async () => proxyUrl) : undefined,
  log: console.warn,
});
const clientId = new ClientIdProvider(http, process.env.SOUNDCLOUD_CLIENT_ID);
const client = new SoundCloudClient(http, clientId);

const problems: string[] = [];

async function run(name: string, raw: RawInput) {
  const out: Item[] = [];
  const started = Date.now();
  const stats = await runScrape(normalizeInput(raw), {
    client,
    log: (m) => console.warn(`  ${name}: ${m}`),
    emit: async (i) => (out.push(i), true),
  });
  const seconds = (Date.now() - started) / 1000;
  console.log(`\n== ${name}: ${out.length} items in ${seconds}s`);
  console.log(JSON.stringify(stats));
  return { out, stats, seconds };
}

// 0. client_id extraction works.
const id = await clientId.get();
if (!/^[0-9a-zA-Z]{32}$/.test(id)) problems.push(`bad client_id: ${id}`);
else console.log(`client_id OK (${id.slice(0, 6)}…)`);

// 1. Prefill input (what the daily test runs): 2 tracks + 1 user.
const def = await run("prefill", prefill);
if (def.out.length !== 3) problems.push(`prefill: ${def.out.length}/3 items`);
if (def.seconds > 45) problems.push(`prefill took ${def.seconds}s`);
const tracks = def.out.filter((i) => i.type === "track");
const users = def.out.filter((i) => i.type === "user");
if (tracks.length !== 2) problems.push(`prefill: ${tracks.length}/2 tracks`);
if (users.length !== 1) problems.push(`prefill: ${users.length}/1 user`);
for (const t of tracks) {
  if (!t.id || !t.title || !t.url?.startsWith("https://"))
    problems.push(`track missing core fields: ${JSON.stringify(t)}`);
  if (!(typeof t.playbackCount === "number" && t.playbackCount > 0))
    problems.push(`${t.title}: no playbackCount`);
  if (!(typeof t.likesCount === "number"))
    problems.push(`${t.title}: no likesCount`);
  if (!(typeof t.durationMs === "number" && t.durationMs > 0))
    problems.push(`${t.title}: no durationMs`);
  if (!t.username) problems.push(`${t.title}: no username`);
}
for (const u of users) {
  if (!u.username || !(typeof u.followersCount === "number"))
    problems.push(`user missing fields: ${JSON.stringify(u)}`);
}
console.log(JSON.stringify(def.out[0], null, 2));

// 2. Search: tracks, users, playlists.
for (const [searchType, max] of [
  ["tracks", 5],
  ["users", 3],
  ["playlists", 3],
] as const) {
  const s = await run(`search-${searchType}`, {
    search: "lofi",
    searchType,
    maxItems: max,
  });
  if (s.out.length !== max)
    problems.push(`search-${searchType}: ${s.out.length}/${max}`);
  const want = searchType.slice(0, -1); // tracks->track
  if (!s.out.every((i) => i.type === want))
    problems.push(`search-${searchType}: wrong item types`);
  if (!s.out.every((i) => i.id && i.url))
    problems.push(`search-${searchType}: items missing id/url`);
}

// 3. Unknown URL is skipped (notFound), not a hard failure.
const nf = await run("not-found", {
  urls: ["https://soundcloud.com/this-user-does-not-exist-zzzqq/nope-nope"],
});
if (nf.out.length !== 0 || nf.stats.notFound !== 1)
  problems.push(
    `not-found: expected 0 items / 1 notFound, got ${nf.out.length}/${nf.stats.notFound}`,
  );

console.log(`\n${http.requests} requests total`);
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
