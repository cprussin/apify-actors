import { describe, expect, it } from "vitest";
import {
  addDatasetSources,
  InputError,
  MAX_SOURCES,
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

  it("reads dataset inputs", () => {
    expect(normalizeInput({}).dataset).toBeNull();
    const n = normalizeInput({
      urls: ["https://x.org/a.pdf"],
      datasetItems: [
        { attachment: { href: "https://x.org/b.pdf" } },
        { attachment: { href: "https://x.org/a.pdf" } },
        { attachment: {} },
        { attachment: { href: "https://x.org/c.pdf" } },
      ],
      datasetField: "attachment",
      datasetId: "me~reports",
      maxDatasetItems: 3,
    });
    expect(n.sources).toEqual([
      {
        index: 0,
        kind: "url",
        input: "https://x.org/a.pdf",
        url: "https://x.org/a.pdf",
      },
      {
        index: 1,
        kind: "url",
        input: "https://x.org/b.pdf",
        url: "https://x.org/b.pdf",
        origin: { datasetId: null, itemIndex: 0 },
      },
      {
        index: 2,
        kind: "invalid",
        input: "datasetItems",
        error: expect.stringMatching(/No document URL in dataset item 2/),
        origin: { datasetId: null, itemIndex: 2 },
      },
    ]);
    expect(n.dataset).toEqual({
      id: "me~reports",
      field: "attachment",
      maxItems: 3,
    });
    // A dataset alone replaces the sample document.
    expect(normalizeInput({ datasetId: "me~reports" }).sources).toEqual([]);
    for (const bad of [
      { datasetId: "a b" },
      { datasetField: ".x" },
      { datasetItems: {} as never },
      { maxDatasetItems: 10_001 },
    ])
      expect(() => normalizeInput(bad)).toThrow(InputError);
  });
});

describe("addDatasetSources", () => {
  it("skips listed URLs, keeps row errors and caps the run", () => {
    const sources = normalizeInput({ urls: ["https://x.org/a.pdf"] }).sources;
    const origin = (i: number) => ({ datasetId: "d", itemIndex: i });
    const dropped = addDatasetSources(sources, [
      { origin: origin(0), url: "x.org/a.pdf" },
      { origin: origin(1), url: "ftp://x.org/b.pdf" },
      { origin: origin(2), error: "No document URL." },
    ]);
    expect(dropped).toBe(0);
    expect(sources.map((s) => [s.index, s.kind, s.input])).toEqual([
      [0, "url", "https://x.org/a.pdf"],
      [1, "invalid", "ftp://x.org/b.pdf"],
      [2, "invalid", "d"],
    ]);
    const full = normalizeInput({
      urls: Array.from(
        { length: MAX_SOURCES },
        (_, i) => `https://x.org/${i}.pdf`,
      ),
    }).sources;
    expect(
      addDatasetSources(full, [{ origin: origin(0), url: "https://y.org" }]),
    ).toBe(1);
    expect(full).toHaveLength(MAX_SOURCES);
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
