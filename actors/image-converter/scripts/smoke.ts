/**
 * Local smoke test (no Apify platform): converts the generated 640x480
 * sample PNG, or the given image URLs, to every output format and prints
 * sizes and timings. Output files go to ./storage/smoke/.
 * Usage: npm run smoke -w actors/image-converter [-- <image URL>...]
 * Behind a proxy, run with NODE_USE_ENV_PROXY=1.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sampleImage } from "../src/convert.js";
import { downloadToFile } from "../src/download.js";
import { decodeHeic } from "../src/heic.js";
import {
  normalizeInput,
  OUTPUT_FORMATS,
  SAMPLE,
  type RawInput,
} from "../src/input.js";
import { runConversions, type OutputItem } from "../src/run.js";

const urls = process.argv.slice(2);
const outDir = join("storage", "smoke");
await mkdir(outDir, { recursive: true });

for (const outputFormat of OUTPUT_FORMATS) {
  for (const extra of [{}, { targetKb: 20 }] as RawInput[]) {
    const input = normalizeInput({ urls, outputFormat, ...extra });
    const items: OutputItem[] = [];
    const t0 = performance.now();
    await runConversions(input, {
      download: (job, path) => {
        if (job.kind !== "url") throw new Error("URLs only");
        return downloadToFile(job.url, path, {
          maxBytes: input.maxBytes,
          timeoutMs: input.timeoutMs,
        });
      },
      decodeHeic,
      sample: () => sampleImage(SAMPLE.width, SAMPLE.height),
      canCharge: () => true,
      emit: async (item) => {
        items.push(item);
        return { pushed: true, more: true };
      },
      saveFile: async (key, data) => {
        await writeFile(join(outDir, key), data);
        return join(outDir, key);
      },
      deleteFile: async () => {},
    });
    const ms = Math.round(performance.now() - t0);
    for (const i of items)
      console.log(
        [
          outputFormat.padEnd(4),
          extra.targetKb ? `target ${extra.targetKb} KB` : "quality 80  ",
          `${i.inputFormat} ${i.inputWidth}x${i.inputHeight} ${i.inputBytes} B`,
          `-> ${i.outputWidth}x${i.outputHeight} ${i.outputBytes} B (${i.savedPercent}% saved, q=${i.quality})`,
          `${i.chargedEvent ?? "free"}`,
          `${ms} ms`,
          i.error ?? i.warning ?? "",
        ].join(" | "),
      );
  }
}
