/**
 * Live smoke test: downloads real documents and converts them with the
 * Python worker (no Apify platform involved). Needs the Python side
 * (DOC2MD_PYTHON pointing at a venv with requirements.txt) and Tesseract.
 * Usage: npm run smoke -w actors/document-to-markdown
 * Behind a proxy, run with NODE_USE_ENV_PROXY=1.
 */
import { PythonWorker } from "../src/converter.js";
import { download } from "../src/download.js";
import { normalizeInput, SAMPLE_URL, type RawInput } from "../src/input.js";
import { runConversions, type OutputItem } from "../src/run.js";

const worker = new PythonWorker();
const problems: string[] = [];

async function run(raw: RawInput) {
  const input = normalizeInput(raw);
  const items: OutputItem[] = [];
  const started = Date.now();
  const stats = await runConversions(input, {
    fetch: async (s) => {
      if (s.kind !== "url") throw new Error("URLs only");
      return download(s.url, {
        maxBytes: input.maxBytes,
        timeoutMs: input.timeoutMs,
      });
    },
    convert: worker.convert,
    canConvert: () => true,
    ocrBudget: () => Infinity,
    emit: async (batch) => {
      items.push(...batch);
      return { pushed: true, more: true };
    },
    log: (m) => console.warn(`  warn: ${m}`),
  });
  console.log(
    `${input.outputFormat}: ${JSON.stringify(stats)} in ${Date.now() - started} ms`,
  );
  return items;
}

const [doc] = await run({ urls: [SAMPLE_URL] });
console.log(
  `  ${doc?.title} | ${doc?.pageCount} pages | ${doc?.wordCount} words | tables: ${(doc?.content?.match(/^\|.*\|$/gm) ?? []).length} rows`,
);
console.log(doc?.content?.slice(0, 600));
if (!doc || doc.error || (doc.wordCount ?? 0) < 3000)
  problems.push(`sample PDF: ${doc?.error ?? "too few words"}`);

const chunks = await run({
  urls: [SAMPLE_URL],
  outputFormat: "chunks",
  chunkSize: 1500,
});
console.log(
  `  ${chunks.length} chunks; pages of first 5: ${chunks
    .slice(0, 5)
    .map((c) => `${c.pageStart}-${c.pageEnd}`)
    .join(", ")}`,
);
if (chunks.some((c) => c.pageStart === null || (c.content?.length ?? 0) > 1500))
  problems.push("chunks without pages or over size");

const [missing] = await run({ urls: ["https://arxiv.org/pdf/0000.00000x"] });
if (!missing?.error) problems.push("missing document did not fail");
console.log(`  missing: ${missing?.error}`);

worker.close();
if (problems.length) {
  console.error(`FAILED:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("OK");
