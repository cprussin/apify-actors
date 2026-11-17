/**
 * Local smoke test and CPU benchmark (no Apify platform): converts the
 * generated 3 s test clip, or the given video URLs or local files, to every
 * output format and prints sizes, wall time and CPU time (FFmpeg included)
 * per minute of output. Output files go to ./storage/smoke/.
 * Usage: npm run smoke -w actors/media-converter [-- <URL or path>...]
 * Env: MEDIA_FFMPEG/MEDIA_FFPROBE to use another FFmpeg build,
 * SMOKE_MAX_HEIGHT (default 720), MEDIA_THREADS (default 1, as at 4 GB).
 * Behind a proxy, run with NODE_USE_ENV_PROXY=1.
 */
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { downloadToFile } from "../src/download.js";
import { Ffmpeg } from "../src/ffmpeg.js";
import { normalizeInput, OUTPUT_FORMATS, type RawInput } from "../src/input.js";
import { runConversions, type OutputItem } from "../src/run.js";

const LOCAL = "https://local.invalid/";
const args = process.argv.slice(2);
const locals = new Map<string, string>();
const urls = await Promise.all(
  args.map(async (a, i) => {
    if (/^https?:\/\//.test(a)) return a;
    await stat(a);
    const url = `${LOCAL}${i}/${encodeURIComponent(basename(a))}`;
    locals.set(url, a);
    return url;
  }),
);
const outDir = join("storage", "smoke");
await mkdir(outDir, { recursive: true });
const threads = Number(process.env.MEDIA_THREADS) || 1;
const maxHeight = Number(process.env.SMOKE_MAX_HEIGHT) || 720;
const media = new Ffmpeg();

/** CPU seconds of this process and its finished children (Linux). */
async function cpuSeconds(): Promise<number> {
  const s = (await readFile("/proc/self/stat", "utf8")).split(") ")[1]!;
  const f = s.split(" ").map(Number);
  return (f[11]! + f[12]! + f[13]! + f[14]!) / 100;
}

let failed = 0;
for (const outputFormat of OUTPUT_FORMATS) {
  const input = normalizeInput({ urls, outputFormat, maxHeight } as RawInput);
  const items: OutputItem[] = [];
  const cpu0 = await cpuSeconds();
  const t0 = performance.now();
  await runConversions(input, {
    download: async (job, path) => {
      if (job.kind !== "url") throw new Error("URLs only");
      const local = locals.get(job.url);
      if (!local)
        return downloadToFile(job.url, path, {
          maxBytes: input.maxBytes,
          timeoutMs: input.timeoutMs,
        });
      await copyFile(local, path);
      const buf = await readFile(path);
      return {
        path,
        bytes: buf.length,
        head: buf.subarray(0, 4096),
        contentType: null,
        fileName: basename(local),
      };
    },
    media,
    threads,
    cpus: threads,
    canCharge: () => true,
    emit: async (item) => {
      items.push(item);
      return { pushed: true, more: true };
    },
    saveFile: async (key, path) => {
      await copyFile(path, join(outDir, key));
      return join(outDir, key);
    },
    deleteFile: async () => {},
  });
  const wall = (performance.now() - t0) / 1000;
  const cpu = (await cpuSeconds()) - cpu0;
  for (const i of items) {
    if (i.error) failed += 1;
    const mins = (i.outputDurationSeconds ?? 0) / 60;
    console.log(
      [
        outputFormat.padEnd(4),
        `${i.inputVideoCodec ?? "-"}/${i.inputAudioCodec ?? "-"} ${i.inputWidth ?? "-"}x${i.inputHeight ?? "-"} ${i.inputDurationSeconds ?? "?"} s ${i.inputBytes} B`,
        `-> ${i.outputVideoCodec ?? "-"}/${i.outputAudioCodec ?? "-"} ${i.outputWidth ?? "-"}x${i.outputHeight ?? "-"} ${i.outputBytes} B (${i.savedPercent}% saved)`,
        `${i.chargedMinutes ?? 0} x ${i.chargedEvent ?? "free"}`,
        `wall ${wall.toFixed(1)} s, cpu ${cpu.toFixed(1)} s` +
          (mins > 0.5 ? `, cpu/min ${(cpu / mins).toFixed(1)} s` : ""),
        i.error ?? i.warning ?? "",
      ].join(" | "),
    );
  }
}
if (failed) {
  console.error(`${failed} conversion(s) failed.`);
  process.exitCode = 1;
}
