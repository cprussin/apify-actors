import { describe, expect, it } from "vitest";
import {
  InputError,
  MAX_FRAMES,
  normalizeInput,
  parseRecordRef,
  SAMPLE_URL,
  socialUrlError,
} from "../src/input.js";

describe("normalizeInput", () => {
  it("falls back to the sample video with defaults", () => {
    expect(normalizeInput({})).toEqual({
      sources: [{ index: 0, kind: "url", input: SAMPLE_URL, url: SAMPLE_URL }],
      mode: "interval",
      intervalSecs: 10,
      frameCount: 0,
      sceneThreshold: 0.3,
      minSceneSecs: 1,
      maxFrames: 50,
      frameFormat: "jpg",
      frameQuality: 85,
      maxWidth: 1280,
      contactSheetColumns: 0,
      gif: null,
      audioFormat: null,
      maxDurationSecs: 3600,
      maxBytes: 1000 * 1024 * 1024,
      timeoutMs: 600_000,
    });
    expect(normalizeInput(null).sources).toHaveLength(1);
  });

  it("combines URLs, start URLs and records, refusing social links", () => {
    const { sources } = normalizeInput({
      urls: ["example.com/a.mp4", "https://example.com/a.mp4", "ftp://x/y"],
      startUrls: [{ url: "https://youtu.be/abc" }, null],
      keyValueStoreRecords: "abc/clip.mov me~videos/b.webm bad",
    });
    expect(sources).toEqual([
      {
        index: 0,
        kind: "url",
        input: "example.com/a.mp4",
        url: "https://example.com/a.mp4",
      },
      {
        index: 1,
        kind: "invalid",
        input: "ftp://x/y",
        error: expect.stringMatching(/^Invalid URL "ftp:\/\/x\/y"/),
      },
      {
        index: 2,
        kind: "invalid",
        input: "https://youtu.be/abc",
        error: expect.stringMatching(/^YouTube links are not supported/),
      },
      { index: 3, kind: "kv", input: "abc/clip.mov", store: "abc", key: "clip.mov" },
      { index: 4, kind: "kv", input: "me~videos/b.webm", store: "me~videos", key: "b.webm" },
      {
        index: 5,
        kind: "invalid",
        input: "bad",
        error: expect.stringMatching(/Invalid key-value store record/),
      },
    ]); // prettier-ignore
  });

  it("reads the options", () => {
    const n = normalizeInput({
      mode: "SCENE",
      sceneThreshold: "45",
      minSceneSeconds: 0,
      maxFrames: 200,
      frameFormat: "jpeg",
      frameQuality: 70,
      maxWidth: 0,
      contactSheet: true,
      contactSheetColumns: 6,
      gifClip: true,
      gifStartSeconds: 30,
      gifDurationSeconds: 3,
      audioFormat: "mp3",
      maxDurationMinutes: 180,
    });
    expect(n).toMatchObject({
      mode: "scene",
      sceneThreshold: 0.45,
      minSceneSecs: 0,
      maxFrames: 200,
      frameFormat: "jpg",
      frameQuality: 70,
      maxWidth: 0,
      contactSheetColumns: 6,
      gif: { startSecs: 30, durationSecs: 3, width: 480, fps: 10 },
      audioFormat: "mp3",
      maxDurationSecs: 10_800,
    });
  });

  it("has no contact sheet without frames", () => {
    expect(
      normalizeInput({ mode: "none", contactSheet: true }).contactSheetColumns,
    ).toBe(0);
  });

  it("rejects out-of-range and unknown values", () => {
    const bad = [
      { mode: "every-frame" },
      { frameFormat: "bmp" },
      { audioFormat: "flac" },
      { maxDurationMinutes: 181 },
      { maxFrames: MAX_FRAMES + 1 },
      { intervalSeconds: 0 },
      { sceneThreshold: 100 },
      { gifClip: true, gifDurationSeconds: 16 },
      { frameQuality: "high" },
      {
        urls: Array.from({ length: 1001 }, (_, i) => `https://x.org/${i}.mp4`),
      },
    ];
    for (const raw of bad)
      expect(() => normalizeInput(raw), JSON.stringify(raw).slice(0, 80)).toThrow(
        InputError,
      ); // prettier-ignore
  });
});

describe("socialUrlError", () => {
  it.each([
    ["https://www.youtube.com/watch?v=1", "YouTube"],
    ["https://m.tiktok.com/v/1", "TikTok"],
    ["https://scontent.cdninstagram.com/v/x.mp4", "Instagram"],
    ["https://fb.watch/abc", "Facebook"],
    ["https://x.com/a/status/1", "X (Twitter)"],
    ["https://vimeo.com/123", "Vimeo"],
    ["https://v.redd.it/abc", "Reddit"],
  ])("refuses %s", (url, name) => {
    expect(socialUrlError(url)).toMatch(
      new RegExp(`^${name.replace(/[()]/g, "\\$&")} links`),
    );
  });

  it("allows other hosts", () => {
    expect(
      socialUrlError("https://cdn.example.com/youtube.com.mp4"),
    ).toBeNull();
    expect(socialUrlError("https://notyoutube.com/a.mp4")).toBeNull();
  });
});

describe("parseRecordRef", () => {
  it("parses store/key", () => {
    expect(parseRecordRef(" s1/video.mp4 ")).toEqual({ store: "s1", key: "video.mp4" });
    expect(parseRecordRef("a/b/c")).toBeNull();
  }); // prettier-ignore
});
