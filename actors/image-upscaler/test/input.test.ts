import { describe, expect, it } from "vitest";
import {
  InputError,
  normalizeInput,
  parseRecordRef,
  SAMPLE_URL,
  socialUrlError,
} from "../src/input.js";

describe("normalizeInput", () => {
  it("falls back to the sample image with defaults", () => {
    const n = normalizeInput({});
    expect(n.sources).toEqual([
      { index: 0, kind: "url", input: SAMPLE_URL, url: SAMPLE_URL },
    ]);
    expect(n).toMatchObject({
      scale: 4,
      outputFormat: "png",
      quality: 90,
      maxInputPixels: 2_000_000,
      maxBytes: 25 * 1024 * 1024,
      timeoutMs: 60_000,
    });
  });

  it("combines and dedupes URLs, start URLs and records", () => {
    const n = normalizeInput({
      urls: ["example.com/a.jpg", "https://example.com/a.jpg", "not a url"],
      startUrls: [{ url: "https://example.com/b.png" }, null],
      keyValueStoreRecords: ["abc123/photo.png", "me~uploads/cat.jpg", "bad"],
    });
    expect(n.sources.map((s) => s.kind)).toEqual([
      "url",
      "invalid",
      "url",
      "kv",
      "kv",
      "invalid",
    ]);
    expect(n.sources[0]).toMatchObject({ url: "https://example.com/a.jpg" });
    expect(n.sources[3]).toMatchObject({ store: "abc123", key: "photo.png" });
    expect(n.sources[4]).toMatchObject({ store: "me~uploads", key: "cat.jpg" });
    expect(n.sources.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("refuses social-network links", () => {
    const n = normalizeInput({
      urls: [
        "https://www.instagram.com/p/abc/",
        "https://pbs.twimg.com/media/x.jpg",
        "https://i.pinimg.com/originals/a.jpg",
        "https://example.com/ok.jpg",
      ],
    });
    expect(n.sources.map((s) => s.kind)).toEqual([
      "invalid",
      "invalid",
      "invalid",
      "url",
    ]);
    expect(socialUrlError("https://scontent.cdninstagram.com/x.jpg")).toMatch(
      /Instagram/,
    );
    expect(socialUrlError("https://example.com/x.jpg")).toBeNull();
  });

  it("parses options", () => {
    const n = normalizeInput({
      scale: "2",
      outputFormat: "JPEG",
      quality: 75,
      maxInputMegapixels: "0.5",
    });
    expect(n).toMatchObject({
      scale: 2,
      outputFormat: "jpg",
      quality: 75,
      maxInputPixels: 500_000,
    });
    expect(normalizeInput({ maxInputMegapixels: 1 }).maxInputPixels).toBe(
      1_000_000,
    );
  });

  it("rejects invalid options", () => {
    expect(() => normalizeInput({ scale: 8 })).toThrow(InputError);
    expect(() => normalizeInput({ scale: 1 })).toThrow(/scale/);
    expect(() => normalizeInput({ outputFormat: "gif" })).toThrow(/gif/);
    expect(() => normalizeInput({ quality: 0 })).toThrow(/quality/);
    expect(() => normalizeInput({ maxInputMegapixels: "3" })).toThrow(
      /maxInputMegapixels/,
    );
    expect(() => normalizeInput({ maxInputMegapixels: "x" })).toThrow(
      /maxInputMegapixels/,
    );
    expect(() =>
      normalizeInput({
        urls: Array.from({ length: 1001 }, (_, i) => `https://x.org/${i}.png`),
      }),
    ).toThrow(/1000/);
  });
});

describe("parseRecordRef", () => {
  it("parses store/key references", () => {
    expect(parseRecordRef("abc/key.png")).toEqual({
      store: "abc",
      key: "key.png",
    });
    expect(parseRecordRef("a/b/c")).toBeNull();
    expect(parseRecordRef("nokey")).toBeNull();
  });
});
