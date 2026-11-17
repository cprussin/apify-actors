import { describe, expect, it } from "vitest";
import {
  InputError,
  normalizeInput,
  normalizeUrl,
  parseRecordRef,
  SAMPLE_NAME,
  socialUrlError,
} from "../src/input.js";

describe("normalizeInput", () => {
  it("defaults to converting the generated test clip to MP4", () => {
    const n = normalizeInput({ outputFormat: "mp4" });
    expect(n.sources).toEqual([
      { index: 0, kind: "sample", input: SAMPLE_NAME },
    ]);
    expect(n).toMatchObject({
      outputFormat: "mp4",
      crf: 23,
      targetBytes: null,
      maxHeight: 1080,
      startSecs: 0,
      durationSecs: null,
      mute: false,
      maxDurationSecs: 1800,
      maxBytes: 1000 * 1024 * 1024,
      timeoutMs: 600_000,
    });
    expect(normalizeInput(null).outputFormat).toBe("mp4");
  });

  it("combines and dedupes URLs, start URLs and records", () => {
    const n = normalizeInput({
      urls: ["example.com/a.mp4", "https://example.com/a.mp4"],
      startUrls: [{ url: "https://example.com/b.mov" }],
      keyValueStoreRecords: ["abc/clip.mp4", "abc/clip.mp4", "bad record"],
    });
    expect(n.sources).toEqual([
      {
        index: 0,
        kind: "url",
        input: "example.com/a.mp4",
        url: "https://example.com/a.mp4",
      },
      {
        index: 1,
        kind: "url",
        input: "https://example.com/b.mov",
        url: "https://example.com/b.mov",
      },
      {
        index: 2,
        kind: "kv",
        input: "abc/clip.mp4",
        store: "abc",
        key: "clip.mp4",
      },
      expect.objectContaining({
        index: 3,
        kind: "invalid",
        input: "bad record",
      }),
    ]);
  });

  it("refuses social and video-platform links per item", () => {
    const n = normalizeInput({
      urls: [
        "https://www.youtube.com/watch?v=x",
        "https://vm.tiktok.com/abc",
        "https://cdn.example.com/v.mp4",
      ],
    });
    expect(n.sources.map((s) => s.kind)).toEqual(["invalid", "invalid", "url"]);
    expect(n.sources[0]).toMatchObject({
      error: expect.stringMatching(/^YouTube links are not supported/),
    });
  });

  it("parses formats, quality, size target, trim and limits", () => {
    const n = normalizeInput({
      outputFormat: " WebM ",
      crf: "28",
      targetMb: 25,
      maxHeight: 720,
      startSeconds: 10,
      durationSeconds: 30,
      mute: true,
      maxDurationMinutes: 5,
      maxFileSizeMb: 200,
    });
    expect(n).toMatchObject({
      outputFormat: "webm",
      crf: 28,
      targetBytes: 25 * 1024 * 1024,
      maxHeight: 720,
      startSecs: 10,
      durationSecs: 30,
      mute: true,
      maxDurationSecs: 300,
      maxBytes: 200 * 1024 * 1024,
    });
    expect(normalizeInput({ outputFormat: "aac" }).outputFormat).toBe("m4a");
    expect(normalizeInput({ targetMb: 0, durationSeconds: 0 })).toMatchObject({
      targetBytes: null,
      durationSecs: null,
    });
  });

  it("rejects bad values", () => {
    expect(() => normalizeInput({ outputFormat: "avi" })).toThrow(InputError);
    expect(() => normalizeInput({ crf: 60 })).toThrow(/crf must be between/);
    expect(() => normalizeInput({ maxHeight: 2160 })).toThrow(/maxHeight/);
    expect(() => normalizeInput({ maxDurationMinutes: 999 })).toThrow(
      /maxDurationMinutes/,
    );
    expect(() => normalizeInput({ startSeconds: "soon" })).toThrow(
      /must be a number/,
    );
    expect(() =>
      normalizeInput({
        urls: Array.from({ length: 1001 }, (_, i) => `https://e.com/${i}.mp4`),
      }),
    ).toThrow(/At most 1000/);
  });
});

describe("helpers", () => {
  it("normalizes URLs", () => {
    expect(normalizeUrl("example.com/v.mp4")).toBe("https://example.com/v.mp4");
    expect(normalizeUrl("ftp://example.com/v.mp4")).toBeNull();
    expect(normalizeUrl("localhost/v.mp4")).toBeNull();
  });

  it("names the platform of social links", () => {
    expect(socialUrlError("https://soundcloud.com/a/b")).toMatch(/^SoundCloud/);
    expect(socialUrlError("https://media.example.com/a.mp3")).toBeNull();
  });

  it("parses record references", () => {
    expect(parseRecordRef("me~my-store/clip.mov")).toEqual({
      store: "me~my-store",
      key: "clip.mov",
    });
    expect(parseRecordRef("a/b/c")).toBeNull();
  });
});
