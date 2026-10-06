import { describe, expect, it } from "vitest";
import {
  InputError,
  normalizeInput,
  normalizeUrl,
  parseRecordRef,
  SAMPLE_URL,
} from "../src/input.js";

describe("normalizeInput", () => {
  it("falls back to the sample document with defaults", () => {
    const n = normalizeInput({});
    expect(n.sources).toEqual([
      { index: 0, kind: "url", input: SAMPLE_URL, url: SAMPLE_URL },
    ]);
    expect(n).toMatchObject({
      outputFormat: "markdown",
      chunkSize: 2000,
      chunkOverlap: 200,
      ocr: true,
      ocrLanguage: "eng",
      maxOcrPagesPerDocument: 50,
      maxBytes: 50 * 1024 * 1024,
      maxPagesPerDocument: 1000,
      timeoutMs: 60_000,
      maxConcurrency: 3,
    });
  });

  it("combines URLs, start URLs and key-value store records, deduplicated", () => {
    const n = normalizeInput({
      urls: ["example.com/a.pdf", "https://example.com/a.pdf", "not a url"],
      startUrls: [{ url: "https://example.com/b.docx" }],
      keyValueStoreRecords: ["abc123/report.pdf", "user~docs/x.docx", "bad"],
    });
    expect(n.sources.map((s) => s.kind)).toEqual([
      "url",
      "url",
      "invalid",
      "url",
      "kv",
      "kv",
      "invalid",
    ]);
    expect(n.sources[0]).toMatchObject({ url: "https://example.com/a.pdf" });
    expect(n.sources[4]).toMatchObject({ store: "abc123", key: "report.pdf" });
    expect(n.sources[5]).toMatchObject({ store: "user~docs", key: "x.docx" });
    expect(n.sources.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("does not add the sample when only records are given", () => {
    const n = normalizeInput({ keyValueStoreRecords: ["s/k"] });
    expect(n.sources).toHaveLength(1);
    expect(n.sources[0]!.kind).toBe("kv");
  });

  it("validates options", () => {
    expect(() => normalizeInput({ outputFormat: "pdf" })).toThrow(InputError);
    expect(() => normalizeInput({ chunkSize: 100 })).toThrow(/chunkSize/);
    expect(() =>
      normalizeInput({ chunkSize: 1000, chunkOverlap: 600 }),
    ).toThrow(/half/);
    expect(() => normalizeInput({ ocrLanguage: "xx" })).toThrow(/ocrLanguage/);
    expect(
      normalizeInput({ outputFormat: "CHUNKS", ocr: false }),
    ).toMatchObject({ outputFormat: "chunks", ocr: false });
    expect(normalizeInput({ maxFileSizeMb: "10" }).maxBytes).toBe(10485760);
  });
});

describe("normalizeUrl / parseRecordRef", () => {
  it("normalizes URLs", () => {
    expect(normalizeUrl("example.com/x.pdf")).toBe("https://example.com/x.pdf");
    expect(normalizeUrl("ftp://example.com/x")).toBeNull();
    expect(normalizeUrl("nohost")).toBeNull();
  });

  it("parses record references", () => {
    expect(parseRecordRef(" store/key.pdf ")).toEqual({
      store: "store",
      key: "key.pdf",
    });
    expect(parseRecordRef("store/a/b")).toBeNull();
    expect(parseRecordRef("key-only")).toBeNull();
  });
});
