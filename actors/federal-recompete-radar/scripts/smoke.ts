/**
 * Live smoke test against api.usaspending.gov with the default input.
 * Usage: npm run smoke -w actors/federal-recompete-radar
 */
import { computeWindow, normalizeInput } from "../src/input.js";
import { runRadar } from "../src/run.js";
import type { ContractRecord } from "../src/transform.js";
import { UsaSpendingClient } from "../src/usaspending.js";

const input = normalizeInput({ maxResults: 5 });
const window = computeWindow(input, new Date());
const out: ContractRecord[] = [];
const started = Date.now();

const stats = await runRadar(input, window, {
  client: new UsaSpendingClient({ log: console.warn }),
  log: console.warn,
  emit: async (r) => (out.push(r), true),
});

console.log(JSON.stringify(out, null, 2));
console.log({ window, stats, seconds: (Date.now() - started) / 1000 });

const bad = out.filter(
  (r) =>
    !r.currentEndDate ||
    r.currentEndDate < window.start ||
    r.currentEndDate > window.end ||
    !r.recipientName,
);
if (!out.length || bad.length || stats.mode !== "search_after") {
  console.error("SMOKE FAILED", { count: out.length, bad, mode: stats.mode });
  process.exit(1);
}
console.log("SMOKE OK");
