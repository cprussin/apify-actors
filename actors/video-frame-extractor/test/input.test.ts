import { describe, expect, it } from "vitest";
import {
  InputError,
  MAX_FRAMES,
  normalizeInput,
  parseRecordRef,
  parseTime,
  SAMPLE_URL,
  socialUrlError,
} from "../src/input.js";

describe("normalizeInput", () => {
  it("falls back to the sample video with defaults", () => {
    expect(normalizeInput({})).toEqual({
      sources: [{ index: 0, kind: "url", input: SAMPLE_URL, url: SAMPLE_URL }],
      dataset: null,
      mode: "interval",
      timestamps: [],
      startSecs: 0,
      endSecs: null,
      skipBlank: false,
      removeDuplicates: false,
      duplicateThreshold: 6,
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

  it("reads timestamps, the window and the frame filters", () => {
    const n = normalizeInput({
      mode: "timestamps",
      timestamps: ["00:01:05.250", 12, "1:30", "12", " 0.5 "],
      startTime: "00:00:10",
      endTime: 120,
      skipBlankFrames: true,
      removeNearDuplicates: true,
      duplicateThreshold: 10,
    });
    expect(n.timestamps).toEqual([
      { seconds: 0.5, input: "0.5" },
      { seconds: 12, input: "12" },
      { seconds: 65.25, input: "00:01:05.250" },
      { seconds: 90, input: "1:30" },
    ]);
    expect(n).toMatchObject({
      mode: "timestamps",
      startSecs: 10,
      endSecs: 120,
      skipBlank: true,
      removeDuplicates: true,
      duplicateThreshold: 10,
    });
    expect(parseTime("1:02:03.5", "t")).toBe(3723.5);
    expect(parseTime("", "t")).toBeNull();
  });

  it("adds pasted dataset rows after the URLs, deduped", () => {
    const { sources, dataset } = normalizeInput({
      urls: ["https://x.org/a.mp4"],
      datasetItems: [
        { url: "https://x.org/a.mp4" },
        { clip: { src: "https://x.org/c.mp4" } },
        { videoUrl: ["https://x.org/d.mp4", "https://x.org/e.mp4"] },
      ],
      datasetField: "clip",
    });
    expect(dataset).toBeNull();
    expect(sources).toEqual([
      { index: 0, kind: "url", input: "https://x.org/a.mp4", url: "https://x.org/a.mp4" },
      { index: 1, kind: "invalid", input: "datasetItems", error: expect.stringMatching(/No video URL in dataset item 0 \(looked in field "clip"/), origin: { datasetId: null, itemIndex: 0 } },
      { index: 2, kind: "url", input: "https://x.org/c.mp4", url: "https://x.org/c.mp4", origin: { datasetId: null, itemIndex: 1 } },
      { index: 3, kind: "invalid", input: "datasetItems", error: expect.any(String), origin: { datasetId: null, itemIndex: 2 } },
    ]); // prettier-ignore
  });

  it("keeps a datasetId for main.ts and skips the sample", () => {
    const n = normalizeInput({ datasetId: "me~scraped-videos" });
    expect(n.sources).toEqual([]);
    expect(n.dataset).toEqual({
      id: "me~scraped-videos",
      field: null,
      maxItems: 100,
    });
    expect(
      normalizeInput({ datasetItems: ["https://x.org/a.mp4"] }).sources,
    ).toHaveLength(1);
  });

  it("caps pasted rows at maxDatasetItems", () => {
    const rows = Array.from({ length: 5 }, (_, i) => `https://x.org/${i}.mp4`);
    expect(
      normalizeInput({ datasetItems: rows, maxDatasetItems: 2 }).sources,
    ).toHaveLength(2);
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
      { mode: "timestamps" },
      { timestamps: ["1:75"] },
      { timestamps: ["soon"] },
      { startTime: 30, endTime: "00:00:20" },
      { datasetId: "not a dataset" },
      { datasetField: "a..b" },
      { datasetItems: "https://x.org/a.mp4" as never },
      { maxDatasetItems: 1001 },
      { duplicateThreshold: 33 },
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
