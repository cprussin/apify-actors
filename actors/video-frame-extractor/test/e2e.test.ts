/**
 * End to end on the real sample video (NASA, 84 s): download, FFmpeg,
 * scene mode, contact sheet, GIF and the budget path. Needs the network and
 * FFmpeg, so it only runs with VIDEO_FRAMES_E2E=1 (behind a proxy, also
 * NODE_USE_ENV_PROXY=1). Set FRAMES_FFMPEG/FRAMES_FFPROBE to test the LGPL
 * build from the Docker image.
 */
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { downloadToFile } from "../src/download.js";
import { Ffmpeg } from "../src/ffmpeg.js";
import { normalizeInput, SAMPLE_URL, type RawInput } from "../src/input.js";
import { costUsd, EVENTS, type Charges } from "../src/plan.js";
import { runExtraction, type OutputItem } from "../src/run.js";

const PRICES = {
  [EVENTS.video]: 0.005,
  [EVENTS.frame]: 0.003,
  [EVENTS.sceneMinute]: 0.01,
  [EVENTS.extra]: 0.005,
  [EVENTS.audioMinute]: 0.002,
};

describe.skipIf(!process.env.VIDEO_FRAMES_E2E)("end to end", () => {
  let dir: string;
  let cache: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "frames-e2e-"));
    cache = join(dir, "sample.mp4");
    await downloadToFile(SAMPLE_URL, cache, {
      maxBytes: 100 * 1024 * 1024,
      timeoutMs: 120_000,
    });
  }, 180_000);

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function run(raw: RawInput, budget = Infinity) {
    const items: OutputItem[] = [];
    const files = new Map<string, string>();
    let left = budget;
    const stats = await runExtraction(normalizeInput(raw), {
      // The sample is downloaded once; the download itself is tested above.
      download: async (_job, path) => {
        await copyFile(cache, path);
        return {
          path,
          bytes: 15_000_000,
          head: Buffer.from("\0\0\0\x20ftypisom"),
          contentType: "video/mp4",
          fileName: "KSC_69-71212-sRGB~small.mp4",
        };
      },
      media: new Ffmpeg(2),
      prices: PRICES,
      budgetUsd: () => left,
      emit: async (item, c: Charges) => {
        left -= costUsd(c, PRICES);
        items.push(item);
        return { pushed: true, more: true };
      },
      saveFile: async (key, path, type) => {
        await copyFile(path, join(dir, key));
        files.set(key, type);
        return `file://${join(dir, key)}`;
      },
      deleteFile: async (key) => void files.delete(key),
    });
    return { stats, items, files };
  }

  it("extracts scene keyframes, a contact sheet and a GIF", async () => {
    const { stats, items, files } = await run({
      mode: "scene",
      maxFrames: 3,
      contactSheet: true,
      gifClip: true,
      gifStartSeconds: 40,
      gifDurationSeconds: 3,
      gifWidth: 240,
    });
    const item = items[0]!;
    expect(item.error).toBeNull();
    expect(item).toMatchObject({
      width: 480,
      height: 480,
      videoCodec: "h264",
      hasAudio: false,
      frameCount: 3,
    });
    expect(item.durationSeconds).toBeCloseTo(84.2, 0);
    expect(item.sceneCount).toBeGreaterThan(3);
    expect(item.frames[0]!.timeSeconds).toBe(0);
    expect(item.contactSheetUrl).toMatch(/contact-sheet\.jpg$/);
    expect(item.gifUrl).toMatch(/clip\.gif$/);
    expect(item.charges).toEqual({
      [EVENTS.video]: 1,
      [EVENTS.frame]: 4,
      [EVENTS.sceneMinute]: 2,
      [EVENTS.extra]: 1,
    });
    expect(stats.chargedUsd).toBe(0.042);
    expect(files.size).toBe(5);
  }, 300_000);

  it("takes evenly spaced frames, refuses what the budget can't pay", async () => {
    const { items } = await run(
      { urls: [SAMPLE_URL], frameCount: 4, frameFormat: "webp", maxWidth: 320 },
      0.016,
    );
    expect(items[0]!.error).toMatch(/costs \$0.017, more than the remaining/);
    const ok = await run({ frameCount: 4, frameFormat: "webp", maxWidth: 320 });
    expect(ok.items[0]!.frames.map((f) => [f.width, f.height])).toEqual(
      Array(4).fill([320, 320]),
    );
  }, 300_000);
});
