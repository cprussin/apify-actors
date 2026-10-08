/**
 * Live smoke test and CPU benchmark: downloads real videos and runs every
 * mode with FFmpeg (no Apify platform involved). Prints wall and CPU time
 * (FFmpeg child processes included) per run.
 * Usage: npm run smoke -w actors/video-frame-extractor [-- <video URL>...]
 * Set FRAMES_FFMPEG/FRAMES_FFPROBE to use the LGPL build from the image and
 * FRAMES_THREADS to change the thread count (default 1, as at 4 GB).
 * Behind a proxy, run with NODE_USE_ENV_PROXY=1.
 */
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadToFile } from "../src/download.js";
import { Ffmpeg } from "../src/ffmpeg.js";
import { normalizeInput, SAMPLE_URL, type RawInput } from "../src/input.js";
import { runExtraction, type OutputItem } from "../src/run.js";

const threads = Number(process.env.FRAMES_THREADS) || 1;
const dir = await mkdtemp(join(tmpdir(), "frames-smoke-"));
const problems: string[] = [];

/** CPU seconds of this process and its finished children (Linux). */
async function cpuSeconds(): Promise<number> {
  const stat = (await readFile("/proc/self/stat", "utf8")).split(") ")[1]!;
  const f = stat.split(" ").map(Number);
  // utime, stime, cutime, cstime are fields 14-17 (1-based) of the full line.
  return (f[11]! + f[12]! + f[13]! + f[14]!) / 100;
}

async function run(raw: RawInput, label: string) {
  const input = normalizeInput(raw);
  const items: OutputItem[] = [];
  const cpu0 = await cpuSeconds();
  const t0 = Date.now();
  const stats = await runExtraction(input, {
    download: (job, path) => {
      if (job.kind === "kv") throw new Error("URLs only");
      return downloadToFile(job.url, path, {
        maxBytes: input.maxBytes,
        timeoutMs: input.timeoutMs,
      });
    },
    media: new Ffmpeg(threads),
    prices: {},
    budgetUsd: () => Infinity,
    emit: async (item) => {
      items.push(item);
      return { pushed: true, more: true };
    },
    saveFile: async (key, path) => {
      await copyFile(path, join(dir, key));
      return `file://${join(dir, key)}`;
    },
    deleteFile: async () => {},
    log: (m) => console.warn(`  log: ${m}`),
  });
  const wall = (Date.now() - t0) / 1000;
  const cpu = (await cpuSeconds()) - cpu0;
  for (const i of items)
    console.log(
      `${label}: ${i.url.split("/").pop()} ${i.durationSeconds} s ${i.width}x${i.height} ` +
        (i.error ??
          `${i.frameCount} frame(s)${i.sceneCount !== null ? ` of ${i.sceneCount} scene(s)` : ""}` +
            `${i.contactSheetUrl ? " +sheet" : ""}${i.gifUrl ? " +gif" : ""}${i.audioUrl ? " +audio" : ""}`) +
        ` | wall ${wall.toFixed(1)} s, CPU ${cpu.toFixed(1)} s (incl. download)`,
    );
  return { stats, items };
}

const sample = await run(
  { urls: [SAMPLE_URL], frameCount: 12, contactSheet: true },
  "interval",
);
const s0 = sample.items[0];
if (!s0 || s0.error || s0.frameCount !== 12 || !s0.contactSheetUrl)
  problems.push(`sample interval: ${s0?.error ?? "unexpected output"}`);

const scene = await run(
  { urls: [SAMPLE_URL], mode: "scene", gifClip: true, gifStartSeconds: 30 },
  "scene",
);
if (!scene.items[0]?.frameCount || !scene.items[0].gifUrl)
  problems.push(`sample scene: ${scene.items[0]?.error ?? "no frames"}`);

const [missing] = (
  await run(
    { urls: ["https://images-assets.nasa.gov/video/missing/missing.mp4"] },
    "missing",
  )
).items;
if (!missing?.error) problems.push("missing file did not fail");

for (const url of process.argv.slice(2)) {
  await run({ urls: [url], intervalSeconds: 5, maxFrames: 1000 }, "every 5 s");
  await run({ urls: [url], mode: "scene", maxFrames: 1000 }, "scene");
  await run({ urls: [url], mode: "none", audioFormat: "m4a" }, "audio m4a");
}

await rm(dir, { recursive: true, force: true });
if (problems.length) {
  console.error(`FAILED:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("OK");
