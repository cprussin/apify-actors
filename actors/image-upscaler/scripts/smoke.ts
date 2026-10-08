/**
 * Live smoke test: downloads real images and upscales them with the Python
 * worker (no Apify platform involved), printing CPU seconds per input
 * megapixel. Needs the Python side (UPSCALER_PYTHON pointing at a venv with
 * requirements.txt, UPSCALER_MODEL at the ONNX model).
 * Usage: npm run smoke -w actors/image-upscaler [-- <image URL>...]
 * Behind a proxy, run with NODE_USE_ENV_PROXY=1.
 */
import { downloadToFile } from "../src/download.js";
import { normalizeInput, SAMPLE_URL } from "../src/input.js";
import { runUpscales, type OutputItem } from "../src/run.js";
import { PythonWorker } from "../src/worker.js";

const worker = new PythonWorker();
const urls = process.argv.slice(2);
const input = normalizeInput({
  urls: urls.length ? urls : [SAMPLE_URL],
  outputFormat: "jpg",
});
const items: OutputItem[] = [];
let cpu = 0;
const stats = await runUpscales(input, {
  download: (job, path) => {
    if (job.kind !== "url") throw new Error("URLs only");
    return downloadToFile(job.url, path, {
      maxBytes: input.maxBytes,
      timeoutMs: input.timeoutMs,
    });
  },
  probe: worker.probe,
  upscale: async (req, timeoutMs) => {
    const res = await worker.upscale({ ...req, threads: 1 }, timeoutMs);
    if (res.ok) cpu += res.cpuSeconds;
    return res;
  },
  budgetUnits: () => Infinity,
  emit: async (item) => {
    items.push(item);
    return { pushed: true, more: true };
  },
  saveFile: async (key) => `memory://${key}`,
  deleteFile: async () => {},
  threads: 1,
  timeoutMs: () => 600_000,
  log: (m) => console.warn(`  log: ${m}`),
});
worker.close();
for (const i of items)
  console.log(
    `  ${i.url}: ${i.error ?? `${i.inputWidth}x${i.inputHeight} -> ${i.outputWidth}x${i.outputHeight} in ${i.processingSeconds} s`}`,
  );
console.log(
  `${JSON.stringify(stats)}; ${cpu.toFixed(1)} CPU s` +
    (stats.inputMegapixels
      ? ` (${(cpu / stats.inputMegapixels).toFixed(1)} CPU s per input MP)`
      : ""),
);
if (!stats.upscaled || items.some((i) => i.error)) process.exit(1);
