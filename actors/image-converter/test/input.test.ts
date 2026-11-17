import { describe, expect, it } from "vitest";
import {
  imageUrlsFromItem,
  InputError,
  normalizeInput,
  parseRecordRef,
  SAMPLE_NAME,
  socialUrlError,
} from "../src/input.js";

describe("normalizeInput", () => {
  it("falls back to the generated sample image with defaults", () => {
    const n = normalizeInput({});
    expect(n.sources).toEqual([
      { index: 0, kind: "sample", input: SAMPLE_NAME },
    ]);
    expect(n).toMatchObject({
      dataset: null,
      outputFormat: "webp",
      quality: 80,
      targetBytes: null,
      maxWidth: null,
      maxHeight: null,
      fit: "inside",
      stripMetadata: true,
      maxInputPixels: 50_000_000,
      maxBytes: 50 * 1024 * 1024,
      timeoutMs: 60_000,
    });
  });

  it("does not add the sample when only a dataset is given", () => {
    const n = normalizeInput({ datasetId: "abc123", imageField: "images" });
    expect(n.sources).toEqual([]);
    expect(n.dataset).toEqual({ id: "abc123", field: "images" });
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
      /Instagram links are not supported/,
    );
    expect(socialUrlError("https://example.com/x.jpg")).toBeNull();
  });

  it("parses options and aliases", () => {
    const n = normalizeInput({
      outputFormat: "JPG",
      quality: "70",
      targetKb: 150,
      maxWidth: 1200,
      maxHeight: "0",
      fit: "cover",
      stripMetadata: false,
      maxInputMegapixels: 12,
      maxFileSizeMb: 10,
    });
    expect(n).toMatchObject({
      outputFormat: "jpeg",
      quality: 70,
      targetBytes: 150 * 1024,
      maxWidth: 1200,
      maxHeight: null,
      fit: "cover",
      stripMetadata: false,
      maxInputPixels: 12_000_000,
      maxBytes: 10 * 1024 * 1024,
    });
  });

  it("rejects invalid options", () => {
    expect(() => normalizeInput({ outputFormat: "bmp" })).toThrow(InputError);
    expect(() => normalizeInput({ quality: 0 })).toThrow(/quality/);
    expect(() => normalizeInput({ maxInputMegapixels: 101 })).toThrow(
      /maxInputMegapixels/,
    );
    expect(() => normalizeInput({ fit: "stretch" })).toThrow(/fit/);
    expect(() => normalizeInput({ datasetId: "a/b" })).toThrow(/datasetId/);
    expect(() =>
      normalizeInput({ datasetId: "abc", imageField: "a..b" }),
    ).toThrow(/imageField/);
    expect(() =>
      normalizeInput({
        urls: Array.from({ length: 1001 }, (_, i) => `https://x.org/${i}.png`),
      }),
    ).toThrow(/At most 1000/);
  });
});

describe("parseRecordRef", () => {
  it("accepts store IDs and named stores", () => {
    expect(parseRecordRef("abc/k.png")).toEqual({ store: "abc", key: "k.png" });
    expect(parseRecordRef("me~store/k")).toEqual({
      store: "me~store",
      key: "k",
    });
    expect(parseRecordRef("k.png")).toBeNull();
    expect(parseRecordRef("a/b/c")).toBeNull();
  });
});

describe("imageUrlsFromItem", () => {
  it("reads strings, arrays, objects and dot paths", () => {
    expect(imageUrlsFromItem({ url: " https://x.org/a.jpg " }, "url")).toEqual([
      "https://x.org/a.jpg",
    ]);
    expect(
      imageUrlsFromItem(
        { images: ["https://x.org/a.jpg", { src: "https://x.org/b.jpg" }, 3] },
        "images",
      ),
    ).toEqual(["https://x.org/a.jpg", "https://x.org/b.jpg"]);
    expect(
      imageUrlsFromItem(
        { product: { image: { url: "https://x.org/c.jpg" } } },
        "product.image",
      ),
    ).toEqual(["https://x.org/c.jpg"]);
    expect(imageUrlsFromItem({ product: null }, "product.image")).toEqual([]);
    expect(imageUrlsFromItem({}, "url")).toEqual([]);
  });
});
