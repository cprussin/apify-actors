import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { VideoError, type Downloaded } from "../src/download.js";
import type { MediaTools, VideoInfo } from "../src/ffmpeg.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import { EVENTS, type Charges } from "../src/plan.js";
import { runExtraction, type OutputItem, type RunDeps } from "../src/run.js";

const PRICES = {
  [EVENTS.video]: 0.005,
  [EVENTS.frame]: 0.003,
  [EVENTS.sceneMinute]: 0.01,
  [EVENTS.extra]: 0.005,
  [EVENTS.audioMinute]: 0.002,
};

/** Fake videos: "VIDEO <seconds> <width>x<height> [audio codec]". */
const files: Record<string, string | Error> = {
  "https://x.org/a.mp4": "VIDEO 95 1920x1080 aac",
  "https://x.org/4k.mp4": "VIDEO 61 3840x2160 opus",
  "https://x.org/hour.mp4": "VIDEO 3600 1280x720 aac",
  "https://x.org/b.mov": "VIDEO 30 640x360",
  "https://x.org/long.mp4": "VIDEO 7200 1280x720",
  "https://x.org/song.mp3": "AUDIO 120",
  "https://x.org/page": "<!doctype html><html>",
  "https://x.org/live.m3u8": "#EXTM3U\n#EXT-X-VERSION:3",
  "https://x.org/404.mp4": new VideoError("Download failed: HTTP 404."),
  "https://x.org/broken.mp4": "JUNK",
  "abc/upload.mp4": "VIDEO 10 320x240",
};

const info = (body: string): VideoInfo | null => {
  const [kind, secs, size, audio] = body.split(" ");
  if (kind !== "VIDEO") return null;
  const [w, h] = size!.split("x").map(Number);
  return {
    durationSecs: Number(secs),
    width: w!,
    height: h!,
    codedWidth: w!,
    codedHeight: h!,
    fps: 25,
    videoCodec: "h264",
    videoStream: 0,
    container: "mov,mp4,m4a,3gp,3g2,mj2",
    bitRate: 1_000_000,
    rotation: 0,
    audioCodec: audio ?? null,
    audioSampleRate: audio ? 48000 : null,
    audioChannels: audio ? 2 : null,
  };
};

function harness(
  raw: RawInput,
  opts: {
    budget?: number;
    cuts?: number[];
    failFrameAt?: number;
    failGif?: boolean;
  } = {},
) {
  const items: OutputItem[] = [];
  const charges: Charges[] = [];
  const saved = new Map<string, string>();
  const deleted: string[] = [];
  const calls: string[] = [];
  let budget = opts.budget ?? Infinity;
  const ok = async (out: string) => {
    await writeFile(out, "x");
    return { ok: true as const, bytes: 1 };
  };
  const media: MediaTools = {
    probe: async (path) => {
      const body = await readFile(path, "utf8");
      if (body.startsWith("AUDIO"))
        return { ok: false, error: "The file has no video track." };
      const i = info(body);
      return i
        ? { ok: true, info: i }
        : { ok: false, error: "Not a supported video file." };
    },
    frame: async (_p, _i, t, out, o) => {
      calls.push(`frame ${t} ${o.format} ${o.size?.width ?? "orig"}`);
      if (t === opts.failFrameAt) return { ok: false, error: "decode error" };
      return ok(out);
    },
    scenes: async (_p, _i, threshold) => {
      calls.push(`scenes ${threshold}`);
      return {
        ok: true,
        cuts: (opts.cuts ?? []).map((t, i) => ({
          time: t,
          score: 0.4 + i / 10,
        })),
      };
    },
    contactSheet: async (paths, out, layout) => {
      calls.push(`sheet ${paths.length} ${layout.columns}x${layout.rows}`);
      return ok(out);
    },
    gif: async (_p, _i, g, size, out) => {
      calls.push(`gif ${g.startSecs} ${size.width}x${size.height}`);
      if (opts.failGif) return { ok: false, error: "GIF clip failed: boom." };
      return { ...(await ok(out)), durationSecs: g.durationSecs };
    },
    audio: async (_p, _i, format, out) => {
      calls.push(`audio ${format}`);
      return ok(out);
    },
  };
  const cost = (c: Charges) =>
    Object.entries(c).reduce(
      (s, [e, n]) => s + (PRICES[e as keyof typeof PRICES] ?? 0) * (n ?? 0),
      0,
    );
  const deps: RunDeps = {
    download: async (job, path) => {
      const m = files[job.kind === "kv" ? job.input : job.url];
      if (m === undefined) throw new Error("no such file");
      if (m instanceof Error) throw m;
      await writeFile(path, m);
      return {
        path,
        bytes: m.length,
        head: Buffer.from(m),
        contentType: null,
        fileName: job.kind === "kv" ? job.key : job.url.split("/").pop()!,
      } satisfies Downloaded;
    },
    media,
    prices: PRICES,
    budgetUsd: () => budget,
    emit: async (item, c) => {
      const usd = cost(c);
      if (usd > budget + 1e-9) return { pushed: false, more: false };
      budget -= usd;
      if (Object.keys(c).length) charges.push(c);
      items.push(item);
      return { pushed: true, more: budget >= 0.008 - 1e-9 };
    },
    saveFile: async (key, _path, contentType) => {
      saved.set(key, contentType);
      return `https://store/${key}`;
    },
    deleteFile: async (key) => {
      deleted.push(key);
      saved.delete(key);
    },
    now: () => new Date("2026-10-08T00:00:00Z"),
    clock: () => 0,
  };
  return {
    items,
    charges,
    saved,
    deleted,
    calls,
    deps,
    run: () => runExtraction(normalizeInput(raw), deps),
  };
}

const by = (items: OutputItem[], url: string) =>
  items.find((i) => i.url.includes(url))!;

describe("runExtraction", () => {
  it("extracts interval frames with metadata, stores and bills them", async () => {
    const h = harness({
      urls: ["https://x.org/a.mp4"],
      intervalSeconds: 30,
      frameFormat: "webp",
      maxWidth: 640,
    });
    const stats = await h.run();
    expect(stats).toMatchObject({
      processed: 1,
      failed: 0,
      frames: 4,
      chargedUsd: 0.017,
      stopReason: "done",
    });
    expect(h.calls).toEqual([
      "frame 0 webp 640",
      "frame 30 webp 640",
      "frame 60 webp 640",
      "frame 90 webp 640",
    ]);
    expect(h.charges).toEqual([{ [EVENTS.video]: 1, [EVENTS.frame]: 4 }]);
    const item = h.items[0]!;
    expect(item).toMatchObject({
      url: "https://x.org/a.mp4",
      sourceType: "url",
      fileName: "a.mp4",
      mode: "interval",
      durationSeconds: 95,
      width: 1920,
      height: 1080,
      fps: 25,
      videoCodec: "h264",
      audioCodec: "aac",
      hasAudio: true,
      frameCount: 4,
      frameFormat: "webp",
      contactSheetUrl: null,
      costUsd: 0.017,
      error: null,
    });
    expect(item.frames[1]).toEqual({
      index: 2,
      timeSeconds: 30,
      timecode: "00:00:30.000",
      sceneScore: null,
      key: "video-0001-frame-0002.webp",
      url: "https://store/video-0001-frame-0002.webp",
      width: 640,
      height: 360,
      bytes: 1,
    });
    expect(item.frameUrls).toHaveLength(4);
    expect([...h.saved.values()]).toEqual(Array(4).fill("image/webp"));
  });

  it("makes a contact sheet, GIF clip and audio track, billed as extras", async () => {
    // AAC to Opus is re-encoded: billed per started minute.
    const h = harness({
      urls: ["https://x.org/a.mp4"],
      frameCount: 6,
      contactSheet: true,
      contactSheetColumns: 3,
      gifClip: true,
      gifStartSeconds: 10,
      audioFormat: "opus",
    });
    await h.run();
    expect(h.calls.slice(6)).toEqual([
      "sheet 6 3x2",
      "gif 10 480x270",
      "audio opus",
    ]);
    expect(h.charges).toEqual([
      {
        [EVENTS.video]: 1,
        [EVENTS.frame]: 7,
        [EVENTS.extra]: 1,
        [EVENTS.audioMinute]: 2,
      },
    ]);
    expect(h.items[0]).toMatchObject({
      frameCount: 6,
      contactSheetUrl: "https://store/video-0001-contact-sheet.jpg",
      gifUrl: "https://store/video-0001-clip.gif",
      audioUrl: "https://store/video-0001-audio.opus",
      audioFormat: "opus",
      costUsd: 0.035,
    });
    expect(h.saved.get("video-0001-audio.opus")).toBe("audio/ogg");
  });

  it("bills a copied audio track as one extra", async () => {
    const h = harness({
      urls: ["https://x.org/hour.mp4", "https://x.org/4k.mp4"],
      mode: "none",
      audioFormat: "m4a",
    });
    await h.run();
    // AAC to M4A is copied; Opus to M4A is re-encoded.
    expect(by(h.items, "hour").charges).toEqual({
      [EVENTS.video]: 1,
      [EVENTS.extra]: 1,
    });
    expect(by(h.items, "4k").charges).toEqual({
      [EVENTS.video]: 1,
      [EVENTS.audioMinute]: 2,
    });
  });

  it("refuses re-encoded audio the budget can't pay for", async () => {
    const h = harness(
      { urls: ["https://x.org/hour.mp4"], mode: "none", audioFormat: "mp3" },
      { budget: 0.1 },
    );
    const stats = await h.run();
    expect(stats.skippedBudget).toBe(1);
    // 0.005 + 60 audio minutes at 0.002.
    expect(h.items[0]!.error).toMatch(/costs \$0.125, more than/);
    expect(h.calls).toEqual([]);
  });

  it("scales scene minutes and GIF events with the video size", async () => {
    const h = harness(
      {
        urls: ["https://x.org/4k.mp4"],
        mode: "scene",
        gifClip: true,
        gifDurationSeconds: 15,
        gifWidth: 1080,
        gifFps: 25,
      },
      { cuts: [30] },
    );
    await h.run();
    expect(h.calls).toContain("gif 0 1080x608");
    // 4K is 4x 1080p: 2 started minutes -> 8 scene minutes. The GIF is
    // 15 s x 25 fps x 1080x608 = 22 units of 5 s x 10 fps x 480x480, x4.
    expect(h.charges).toEqual([
      {
        [EVENTS.video]: 1,
        [EVENTS.frame]: 2,
        [EVENTS.sceneMinute]: 8,
        [EVENTS.extra]: 88,
      },
    ]);
  });

  it("finds scenes and bills started video minutes", async () => {
    const h = harness(
      {
        urls: ["https://x.org/a.mp4"],
        mode: "scene",
        sceneThreshold: 40,
      },
      { cuts: [0.04, 12.5, 12.9, 40] },
    );
    await h.run();
    expect(h.calls[0]).toBe("scenes 0.4");
    const item = h.items[0]!;
    expect(item.sceneCount).toBe(3);
    expect(item.frames.map((f) => [f.timeSeconds, f.sceneScore])).toEqual([
      [0, 1],
      [12.5, 0.5],
      [40, 0.7],
    ]);
    expect(h.charges).toEqual([
      { [EVENTS.video]: 1, [EVENTS.frame]: 3, [EVENTS.sceneMinute]: 2 },
    ]);
  });

  it("metadata-only mode bills the video alone", async () => {
    const h = harness({
      urls: ["https://x.org/b.mov"],
      mode: "none",
      contactSheet: true,
    });
    await h.run();
    expect(h.calls).toEqual([]);
    expect(h.items[0]).toMatchObject({ frameCount: 0, durationSeconds: 30 });
    expect(h.charges).toEqual([{ [EVENTS.video]: 1 }]);
  });

  it("returns free error items and keeps going", async () => {
    const h = harness({
      urls: [
        "https://x.org/404.mp4",
        "https://x.org/page",
        "https://x.org/live.m3u8",
        "https://x.org/long.mp4",
        "https://x.org/song.mp3",
        "https://x.org/broken.mp4",
        "not a url",
        "https://www.youtube.com/watch?v=x",
        "https://www.tiktok.com/@a/video/1",
        "https://x.org/b.mov",
      ],
      keyValueStoreRecords: ["abc/upload.mp4", "abc/missing.mp4"],
    });
    const stats = await h.run();
    expect(stats).toMatchObject({ processed: 2, failed: 10 });
    const err = (u: string) => by(h.items, u).error;
    expect(err("404")).toMatch(/HTTP 404/);
    expect(err("page")).toMatch(/web page/);
    expect(err("m3u8")).toMatch(/HLS/);
    expect(err("long")).toMatch(/120.0 min long, over the 60 min limit/);
    expect(err("song")).toMatch(/no video track/);
    expect(err("broken")).toMatch(/Not a supported video/);
    expect(err("not a url")).toMatch(/Invalid URL/);
    expect(err("youtube")).toMatch(/YouTube links are not supported/);
    expect(err("tiktok")).toMatch(/TikTok/);
    expect(err("missing")).toMatch(/Download failed: no such file/);
    expect(by(h.items, "upload").sourceType).toBe("kv");
    expect(h.items.filter((i) => i.error).every((i) => i.costUsd === 0)).toBe(
      true,
    );
    expect(h.charges).toHaveLength(2);
    expect(by(h.items, "long").durationSeconds).toBe(7200);
  });

  it("skips frames that won't decode and warns about missing extras", async () => {
    const h = harness(
      {
        urls: ["https://x.org/b.mov"],
        intervalSeconds: 10,
        gifClip: true,
        gifStartSeconds: 60,
        audioFormat: "m4a",
      },
      { failFrameAt: 10 },
    );
    await h.run();
    const item = h.items[0]!;
    expect(item.frames.map((f) => f.timeSeconds)).toEqual([0, 20]);
    expect(item.warning).toMatch(/No frame at 00:00:10.000 \(decode error\)/);
    expect(item.warning).toMatch(/no audio track/);
    expect(item.warning).toMatch(/GIF start \(60 s\) is past the end/);
    expect(h.charges).toEqual([{ [EVENTS.video]: 1, [EVENTS.frame]: 2 }]);
  });

  it("retries a frame at the very end a second earlier", async () => {
    const h = harness(
      { urls: ["https://x.org/b.mov"], intervalSeconds: 29 },
      { failFrameAt: 29 },
    );
    await h.run();
    expect(h.items[0]!.frames.map((f) => f.timeSeconds)).toEqual([0, 28]);
  });

  it("doesn't bill an extra that failed", async () => {
    const h = harness(
      { urls: ["https://x.org/b.mov"], frameCount: 1, gifClip: true },
      { failGif: true },
    );
    await h.run();
    expect(h.items[0]!.warning).toMatch(/GIF clip failed/);
    expect(h.items[0]!.gifUrl).toBeNull();
    expect(h.charges).toEqual([{ [EVENTS.video]: 1, [EVENTS.frame]: 1 }]);
  });

  it("refuses videos the remaining budget can't pay for, then continues", async () => {
    const h = harness(
      {
        urls: ["https://x.org/a.mp4", "https://x.org/b.mov"],
        frameCount: 10,
      },
      // 0.035 per video: the first fits, the second doesn't.
      { budget: 0.05 },
    );
    const stats = await h.run();
    expect(stats).toMatchObject({
      processed: 1,
      skippedBudget: 1,
      stopReason: "budget",
    });
    // Downloads run in parallel: either video may come first.
    expect(h.items.find((i) => i.error)!.error).toMatch(
      /costs \$0.035, more than the remaining max charge per run \(\$0.015\)/,
    );
    expect(h.charges).toHaveLength(1);
  });

  it("keeps only the scenes the budget pays for", async () => {
    const h = harness(
      { urls: ["https://x.org/a.mp4"], mode: "scene", minSceneSeconds: 0 },
      { budget: 0.03, cuts: [10, 20, 30, 40, 50] },
    );
    await h.run();
    // 0.005 + 2 scene minutes 0.02 leaves 0.005: one frame.
    const item = h.items[0]!;
    expect(item.frameCount).toBe(1);
    expect(item.warning).toMatch(/6 scenes found; kept the 1 strongest cuts/);
    expect(h.charges).toEqual([
      { [EVENTS.video]: 1, [EVENTS.frame]: 1, [EVENTS.sceneMinute]: 2 },
    ]);
  });

  it("deletes stored files that could not be charged", async () => {
    const raw = { urls: ["https://x.org/b.mov"], frameCount: 2 };
    const h = harness(raw);
    const stats = await runExtraction(normalizeInput(raw), {
      ...h.deps,
      emit: async () => ({ pushed: false, more: false }),
    });
    expect(stats).toMatchObject({ processed: 0, stopReason: "budget" });
    expect(h.deleted).toEqual([
      "video-0001-frame-0001.jpg",
      "video-0001-frame-0002.jpg",
    ]);
  });
});
