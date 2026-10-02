/**
 * Live smoke test against every state's Socrata dataset.
 * 1. Checks that the fields each adapter queries exist in the dataset metadata.
 * 2. Runs the default search with a small maxResults and validates the output.
 * Usage: npm run smoke -w actors/new-business-registrations
 */
import { ADAPTERS } from "../src/adapters/index.js";
import { computeWindow, normalizeInput } from "../src/input.js";
import type { BusinessRecord } from "../src/record.js";
import { runFeed } from "../src/run.js";
import { SocrataClient } from "../src/socrata.js";

const problems: string[] = [];

for (const a of Object.values(ADAPTERS)) {
  const url = `https://${a.domain}/api/views/${a.datasetId}.json`;
  try {
    const res = await fetch(url);
    const meta = (await res.json()) as {
      name?: string;
      rowsUpdatedAt?: number;
      columns?: { fieldName: string; dataTypeName: string }[];
    };
    const cols = new Map(
      (meta.columns ?? []).map((c) => [c.fieldName, c.dataTypeName]),
    );
    const needed = [
      a.dateField,
      a.idField,
      a.nameField,
      ...a.cityFields,
      ...a.zipFields,
      ...(a.countyField ? [a.countyField] : []),
    ];
    const missing = needed.filter((f) => !cols.has(f));
    if (missing.length) problems.push(`${a.code}: missing ${missing}`);
    if (cols.get(a.dateField) !== "calendar_date")
      problems.push(
        `${a.code}: ${a.dateField} is ${cols.get(a.dateField)}, expected calendar_date`,
      );
    console.log(
      `${a.code} ${a.datasetId} "${meta.name}" updated ${
        meta.rowsUpdatedAt
          ? new Date(meta.rowsUpdatedAt * 1000).toISOString()
          : "?"
      } columns: ${[...cols.keys()].join(", ")}`,
    );
  } catch (e) {
    problems.push(`${a.code}: metadata ${url} failed: ${(e as Error).message}`);
  }
}

const input = normalizeInput({ maxResults: 30 });
const window = computeWindow(input, new Date());
const out: BusinessRecord[] = [];
const started = Date.now();

const stats = await runFeed(input, window, {
  client: new SocrataClient({
    appToken: process.env.SOCRATA_APP_TOKEN,
    log: console.warn,
  }),
  log: console.warn,
  emit: async (r) => (out.push(r), true),
});

console.log(JSON.stringify(out.slice(0, 12), null, 2));
console.log({ window, stats, seconds: (Date.now() - started) / 1000 });

for (const [code, s] of Object.entries(stats.states)) {
  if (s.status === "failed") problems.push(`${code}: ${s.error}`);
  if (!out.some((r) => r.state === code))
    problems.push(`${code}: no records in window`);
}
for (const r of out) {
  if (
    !r.formationDate ||
    r.formationDate < window.from ||
    r.formationDate > window.to ||
    !r.name ||
    !r.entityId
  )
    problems.push(`bad record ${JSON.stringify(r)}`);
}
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
