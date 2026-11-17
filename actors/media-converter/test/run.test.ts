import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { MediaError, type Downloaded } from "../src/download.js";
import type { ConvertPlan, MediaInfo, MediaTools } from "../src/ffmpeg.js";
import { normalizeInput, SAMPLE_NAME, type RawInput } from "../src/input.js";
import type { EventName } from "../src/plan.js";
import {
  convertTimeoutMs,
  outputKey,
  runConversions,
  type OutputItem,
} from "../src/run.js";

const PRICES: Record<EventName, number> = {
  "audio-minute": 0.003,
  "video-480p-minute": 0.008,
  "video-720p-minute": 0.02,
  "video-1080p-minute": 0.04,
};

const MP4_HEAD = Buffer.from("\0\0\0\x20ftypisom");

const video = (
  width: number,
  height: number,
  durationSecs: number,
  audio = true,
): MediaInfo => ({
  durationSecs,
  container: "mov,mp4,m4a,3gp,3g2,mj2",
  bitRate: 8_000_000,
  video: {
    codec: "h264",
    stream: 0,
    width,
    height,
    anamorphic: false,
    fps: 30,
  },
  audio: audio ? { codec: "aac", channels: 2, sampleRate: 48000 } : null,
});

/** url -> [file head, probe result] or a download error. */
const files: Record<string, [Buffer, MediaInfo | string] | Error> = {
  "https://x.org/phone.mp4": [MP4_HEAD, video(1920, 1080, 125)],
  "https://x.org/short.mov": [MP4_HEAD, video(1280, 720, 20)],
  "https://x.org/4k.mp4": [MP4_HEAD, video(3840, 2160, 30)],
  "https://x.org/silent.mp4": [MP4_HEAD, video(640, 360, 10, false)],
  "https://x.org/song.mp3": [
    Buffer.from("ID3\x04"),
    {
      durationSecs: 200,
      container: "mp3",
      bitRate: 320_000,
      video: null,
      audio: { codec: "mp3", channels: 2, sampleRate: 44100 },
    },
  ],
  "https://x.org/long.mp4": [MP4_HEAD, video(1280, 720, 3600)],
  "https://x.org/broken.mp4": [MP4_HEAD, "Not a supported video or audio file (moov atom not found)."],
  "https://x.org/404.mp4": new MediaError("Download failed: HTTP 404."),
  "https://x.org/page": [Buffer.from("<!doctype html><html>"), "unused"],
}; // prettier-ignore

const INPUT_BYTES = 10_000_000;

function harness(
  raw: RawInput,
  opts: { budgetUsd?: number; outBytes?: (plan: ConvertPlan) => number } = {},
) {
  const items: OutputItem[] = [];
  const charges: [EventName, number][] = [];
  const plans: ConvertPlan[] = [];
  const saved: string[] = [];
  const deleted: string[] = [];
  let budget = opts.budgetUsd ?? Infinity;
  const infoByPath = new Map<string, MediaInfo | string>();
  const outInfo = new Map<string, MediaInfo>();
  const media: MediaTools = {
    probe: async (path) => {
      const out = outInfo.get(path);
      if (out) return { ok: true, info: out };
      const info = infoByPath.get(path);
      if (!info) return { ok: false, error: "no file" };
      return typeof info === "string"
        ? { ok: false, error: info }
        : { ok: true, info };
    },
    convert: async (_path, plan, outPath) => {
      plans.push(plan);
      const bytes = opts.outBytes?.(plan) ?? 2_000_000;
      outInfo.set(outPath, {
        durationSecs: plan.durationSecs ?? 1,
        container: plan.format,
        bitRate: 1_000_000,
        video: plan.video
          ? {
              codec: plan.format === "webm" ? "vp9" : "h264",
              stream: 0,
              width: plan.video.width,
              height: plan.video.height,
              anamorphic: false,
              fps: 30,
            }
          : null,
        audio: plan.audio
          ? { codec: "aac", channels: 2, sampleRate: 48000 }
          : null,
      });
      return { ok: true, bytes };
    },
    sample: async (outPath) => {
      infoByPath.set(outPath, {
        ...video(320, 240, 3),
        video: { ...video(320, 240, 3).video!, codec: "mpeg4" },
      });
      return { ok: true, bytes: 400_000 };
    },
  };
  return {
    items,
    charges,
    plans,
    saved,
    deleted,
    run: () =>
      runConversions(normalizeInput(raw), {
        download: async (job, path): Promise<Downloaded> => {
          const f = files[job.kind === "url" ? job.url : job.input];
          if (!f) throw new Error("no such file");
          if (f instanceof Error) throw f;
          await writeFile(path, f[0]);
          infoByPath.set(path, f[1]);
          return {
            path,
            bytes: INPUT_BYTES,
            head: f[0],
            contentType: null,
            fileName: job.kind === "url" ? job.url.split("/").pop()! : job.key,
          };
        },
        media,
        threads: 1,
        cpus: 1,
        canCharge: (event, count) => budget + 1e-9 >= PRICES[event] * count,
        emit: async (item, charge) => {
          if (charge) {
            const usd = PRICES[charge.event] * charge.count;
            if (budget + 1e-9 < usd) return { pushed: false, more: false };
            budget -= usd;
            charges.push([charge.event, charge.count]);
          }
          items.push(item);
          return { pushed: true, more: true };
        },
        saveFile: async (key) => {
          saved.push(key);
          return `https://store/${key}`;
        },
        deleteFile: async (key) => {
          deleted.push(key);
        },
        now: () => new Date("2026-11-17T00:00:00Z"),
        clock: () => 0,
      }),
  };
}

describe("runConversions", () => {
  it("converts the generated sample when no input is given", async () => {
    const h = harness({ outputFormat: "mp4" });
    const stats = await h.run();
    expect(stats).toMatchObject({ converted: 1, failed: 0 });
    expect(h.charges).toEqual([["video-480p-minute", 1]]);
    expect(h.items[0]).toMatchObject({
      url: SAMPLE_NAME,
      sourceType: "sample",
      inputVideoCodec: "mpeg4",
      inputWidth: 320,
      outputVideoCodec: "h264",
      outputAudioCodec: "aac",
      outputWidth: 320,
      outputHeight: 240,
      outputBytes: 2_000_000,
      crf: 23,
      outputKey: "converted-0001-sample-320x240-3s.mp4",
      chargedEvent: "video-480p-minute",
      chargedMinutes: 1,
      error: null,
    });
  });

  it("bills one event per file by output tier and started minutes", async () => {
    const h = harness({
      urls: [
        "https://x.org/phone.mp4",
        "https://x.org/short.mov",
        "https://x.org/4k.mp4",
      ],
      maxHeight: 720,
    });
    await h.run();
    expect(h.charges).toEqual([
      ["video-720p-minute", 3], // 125 s
      ["video-720p-minute", 1],
      ["video-1080p-minute", 1], // 4K input: billed as 1080p
    ]);
    expect(
      h.plans.map((p) => p.video && [p.video.width, p.video.height]),
    ).toEqual([
      [1280, 720],
      [1280, 720],
      [1280, 720],
    ]);
    expect(h.plans[1]!.video!.scale).toBe(false);
    expect(h.items[2]!.warning).toMatch(/above 1080p/);
  });

  it("extracts audio and bills audio minutes; trims", async () => {
    const h = harness({
      urls: ["https://x.org/phone.mp4", "https://x.org/song.mp3"],
      outputFormat: "mp3",
      startSeconds: 30,
      durationSeconds: 90,
    });
    await h.run();
    expect(h.charges).toEqual([
      ["audio-minute", 2], // 90 s from 30 s of 125 s
      ["audio-minute", 2],
    ]);
    expect(h.plans[0]).toMatchObject({
      video: null,
      audio: true,
      startSecs: 30,
      durationSecs: 90,
    });
    expect(h.items[0]).toMatchObject({
      outputVideoCodec: null,
      outputWidth: null,
      crf: null,
      outputDurationSeconds: 90,
    });
  });

  it("fails bad files for free and keeps going", async () => {
    const h = harness({
      urls: [
        "https://x.org/404.mp4",
        "https://x.org/page",
        "https://x.org/broken.mp4",
        "https://x.org/long.mp4",
        "https://www.youtube.com/watch?v=abc",
        "https://x.org/short.mov",
      ],
    });
    const stats = await h.run();
    expect(stats).toMatchObject({ converted: 1, failed: 5 });
    expect(h.items.map((i) => i.error)).toEqual([
      "Download failed: HTTP 404.",
      expect.stringMatching(/web page/),
      expect.stringMatching(/moov atom/),
      expect.stringMatching(/60\.0 min long, over the 30 min limit/),
      expect.stringMatching(/^YouTube links are not supported/),
      null,
    ]);
    expect(h.charges).toEqual([["video-720p-minute", 1]]);
  });

  it("refuses impossible combinations per file", async () => {
    const audioToVideo = harness({ urls: ["https://x.org/song.mp3"] });
    await audioToVideo.run();
    expect(audioToVideo.items[0]!.error).toMatch(/no video track/);
    const silentToMp3 = harness({
      urls: ["https://x.org/silent.mp4"],
      outputFormat: "m4a",
    });
    await silentToMp3.run();
    expect(silentToMp3.items[0]!.error).toBe("The file has no audio track.");
    const late = harness({
      urls: ["https://x.org/short.mov"],
      startSeconds: 20,
    });
    await late.run();
    expect(late.items[0]!.error).toMatch(/past the end/);
    expect([audioToVideo, silentToMp3, late].flatMap((h) => h.charges)).toEqual(
      [],
    );
  });

  it("mutes video and warns about silent inputs", async () => {
    const h = harness({
      urls: ["https://x.org/short.mov", "https://x.org/silent.mp4"],
      mute: true,
    });
    await h.run();
    expect(h.plans.map((p) => p.audio)).toEqual([false, false]);
    expect(h.items[0]!.outputAudioCodec).toBeNull();
    const loud = harness({ urls: ["https://x.org/silent.mp4"] });
    await loud.run();
    expect(loud.items[0]!.warning).toMatch(/no audio track/);
  });

  it("hits a target size, with one retry when the encoder overshoots", async () => {
    const MB = 1024 * 1024;
    let calls = 0;
    const h = harness(
      { urls: ["https://x.org/short.mov"], targetMb: 2 },
      { outBytes: () => (++calls === 1 ? 2.5 * MB : 1.9 * MB) },
    );
    await h.run();
    expect(h.plans).toHaveLength(2);
    expect(h.plans[1]!.videoKbps!).toBeLessThan(h.plans[0]!.videoKbps!);
    expect(h.items[0]).toMatchObject({
      outputBytes: 1.9 * MB,
      crf: null,
      targetMb: 2,
      warning: null,
    });
    expect(h.charges).toEqual([["video-720p-minute", 1]]);
  });

  it("never converts what the max charge can't pay for", async () => {
    // $0.05: phone.mp4 (3 x $0.02) is skipped, short.mov (1 x $0.02) fits.
    const h = harness(
      { urls: ["https://x.org/phone.mp4", "https://x.org/short.mov"], maxHeight: 720 },
      { budgetUsd: 0.05 },
    ); // prettier-ignore
    const stats = await h.run();
    expect(h.items[0]!.error).toMatch(/^Not converted: 3 x video-720p-minute/);
    expect(h.charges).toEqual([["video-720p-minute", 1]]);
    expect(stats).toMatchObject({ converted: 1, skippedBudget: 1 });
    expect(h.plans).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("builds safe, numbered record keys", () => {
    expect(outputKey(0, "My Clip (1).MOV", "mp4")).toBe(
      "converted-0001-My-Clip-(1).mp4",
    );
    expect(outputKey(41, null, "mp3")).toBe("converted-0042.mp3");
  });

  it("scales time limits with length, input size and CPU", () => {
    expect(convertTimeoutMs(60, { width: 1920, height: 1080 }, 1)).toBe(
      300_000 + 124_000,
    );
    expect(
      convertTimeoutMs(60, { width: 1920, height: 1080 }, 0.25),
    ).toBeGreaterThan(convertTimeoutMs(60, { width: 1920, height: 1080 }, 1));
  });
});
