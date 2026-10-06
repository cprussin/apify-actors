import { describe, expect, it } from "vitest";
import type { ConvertRequest, ConvertResult } from "../src/converter.js";
import { DocumentError, type Fetched } from "../src/download.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import {
  assemble,
  MAX_ITEM_CONTENT_BYTES,
  runConversions,
  type Charge,
  type OutputItem,
  type RunDeps,
} from "../src/run.js";

const PDF = Buffer.from("%PDF-1.4 fake");
const DOCX = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from("word/document.xml"),
]);

const files: Record<string, Fetched | Error> = {
  "https://x.org/a.pdf": {
    body: PDF,
    contentType: "application/pdf",
    fileName: "a.pdf",
  },
  "https://x.org/b.docx": { body: DOCX, contentType: null, fileName: "b.docx" },
  "https://x.org/scan.pdf": {
    body: PDF,
    contentType: null,
    fileName: "scan.pdf",
  },
  "https://x.org/404.pdf": new DocumentError("Download failed: HTTP 404."),
  "https://x.org/img.png": {
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]),
    contentType: "image/png",
    fileName: "img.png",
  },
};

const pdfResult = (pages: string[], ocr: boolean[] = []): ConvertResult => ({
  ok: true,
  title: null,
  pages: pages.map((text, i) => ({ text, ocr: ocr[i] ?? false })),
  pageCount: pages.length,
  ocrSkipped: 0,
});

function harness(
  raw: RawInput,
  opts: { budget?: number; ocrBudget?: number } = {},
) {
  const items: OutputItem[] = [];
  const charges: Charge[] = [];
  const requests: ConvertRequest[] = [];
  let budget = opts.budget ?? Infinity;
  const deps: RunDeps = {
    fetch: async (s) => {
      const f = files[s.kind === "url" ? s.url : s.input];
      if (!f) throw new Error("no such file");
      if (f instanceof Error) throw f;
      return f;
    },
    convert: async (req) => {
      requests.push(req);
      if (req.type === "docx")
        return {
          ok: true,
          title: null,
          markdown: "# Report\n\n|  |  |\n| --- | --- |\n| A | B |\n| 1 | 2 |",
        };
      if (req.path.endsWith("doc-2"))
        return pdfResult(["", "Scanned text here"], [false, true]);
      return pdfResult(["Page one text.", "Page two text."]);
    },
    canConvert: () => budget >= 1,
    ocrBudget: () => opts.ocrBudget ?? Infinity,
    emit: async (batch, charge) => {
      if (charge.document) {
        if (budget < 1) return { pushed: false, more: false };
        budget -= 1;
        charges.push(charge);
      }
      items.push(...batch);
      return { pushed: true, more: budget >= 1 };
    },
    saveContent: async (key) => `https://kv/${key}`,
    now: () => new Date("2026-10-06T00:00:00Z"),
  };
  return { deps, items, charges, requests, input: normalizeInput(raw) };
}

describe("runConversions", () => {
  it("converts a batch and records failures for free", async () => {
    const h = harness({
      urls: [
        "https://x.org/a.pdf",
        "https://x.org/b.docx",
        "https://x.org/404.pdf",
        "https://x.org/img.png",
        "bad url",
      ],
      maxConcurrency: 2,
    });
    const stats = await runConversions(h.input, h.deps);
    expect(stats).toMatchObject({
      converted: 2,
      failed: 3,
      stopReason: "done",
    });
    expect(h.charges).toEqual([
      { document: true, ocrPages: 0 },
      { document: true, ocrPages: 0 },
    ]);
    const byUrl = Object.fromEntries(h.items.map((i) => [i.url, i]));
    expect(byUrl["https://x.org/a.pdf"]).toMatchObject({
      fileType: "pdf",
      content: "Page one text.\n\nPage two text.",
      pageCount: 2,
      wordCount: 6,
      error: null,
    });
    expect(byUrl["https://x.org/b.docx"]).toMatchObject({
      title: "Report",
      content: "# Report\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
    });
    expect(byUrl["https://x.org/404.pdf"]!.error).toBe(
      "Download failed: HTTP 404.",
    );
    expect(byUrl["https://x.org/img.png"]!.error).toMatch(/image/);
    expect(byUrl["bad url"]!.error).toMatch(/Invalid URL/);
    expect(h.requests.map((r) => r.type).sort()).toEqual(["docx", "pdf"]);
  });

  it("outputs plain text", async () => {
    const h = harness({ urls: ["https://x.org/b.docx"], outputFormat: "text" });
    await runConversions(h.input, h.deps);
    expect(h.items[0]!.content).toBe("Report\n\nA\tB\n1\t2");
  });

  it("outputs chunks with page numbers, charging once per document", async () => {
    const h = harness({
      urls: ["https://x.org/a.pdf"],
      outputFormat: "chunks",
      chunkSize: 200,
      chunkOverlap: 0,
    });
    const stats = await runConversions(h.input, h.deps);
    expect(stats.items).toBe(1);
    expect(h.items).toHaveLength(1);
    expect(h.items[0]).toMatchObject({
      chunkIndex: 0,
      chunkCount: 1,
      pageStart: 1,
      pageEnd: 2,
      content: "Page one text.\n\nPage two text.",
    });
    expect(h.charges).toHaveLength(1);
  });

  it("charges OCR pages and passes the OCR budget", async () => {
    const h = harness(
      {
        urls: [
          "https://x.org/a.pdf",
          "https://x.org/b.docx",
          "https://x.org/scan.pdf",
        ],
        maxConcurrency: 1,
        maxOcrPagesPerDocument: 10,
      },
      { ocrBudget: 4 },
    );
    await runConversions(h.input, h.deps);
    expect(h.charges.at(-1)).toEqual({ document: true, ocrPages: 1 });
    const pdfReq = h.requests.find((r) => r.path.endsWith("doc-2"))!;
    expect(pdfReq).toMatchObject({ ocr: true, maxOcrPages: 4 });
    expect(h.requests.find((r) => r.type === "docx")!.maxOcrPages).toBe(0);
    expect(h.items.at(-1)).toMatchObject({ ocrPages: 1, pageCount: 2 });
  });

  it("stops at the budget", async () => {
    const h = harness(
      {
        urls: [
          "https://x.org/a.pdf",
          "https://x.org/b.docx",
          "https://x.org/scan.pdf",
        ],
        maxConcurrency: 1,
      },
      { budget: 1 },
    );
    const stats = await runConversions(h.input, h.deps);
    expect(stats).toMatchObject({ converted: 1, stopReason: "budget" });
    expect(h.items).toHaveLength(1);
  });

  it("fails documents without text, for free", async () => {
    const h = harness({ urls: ["https://x.org/a.pdf"] });
    h.deps.convert = async () =>
      ({ ...pdfResult(["", ""]), ocrSkipped: 2 }) as ConvertResult;
    const stats = await runConversions(h.input, h.deps);
    expect(stats.failed).toBe(1);
    expect(h.charges).toEqual([]);
    expect(h.items[0]!.error).toMatch(
      /No text found\. 2 page\(s\) without a text layer/,
    );
  });

  it("reports converter errors", async () => {
    const h = harness({ urls: ["https://x.org/a.pdf"] });
    h.deps.convert = async () => ({
      ok: false,
      error: "The PDF is password-protected.",
    });
    await runConversions(h.input, h.deps);
    expect(h.items[0]).toMatchObject({
      error: "The PDF is password-protected.",
      fileType: "pdf",
      fileName: "a.pdf",
    });
  });

  it("moves oversized content to the key-value store", async () => {
    const h = harness({ urls: ["https://x.org/a.pdf"] });
    const big = "word ".repeat(MAX_ITEM_CONTENT_BYTES / 5 + 10);
    h.deps.convert = async () => pdfResult([big]);
    await runConversions(h.input, h.deps);
    const item = h.items[0]!;
    expect(item.contentUrl).toBe("https://kv/document-0001.md");
    expect(item.content!.length).toBe(1_000_000);
    expect(item.charCount).toBeGreaterThan(MAX_ITEM_CONTENT_BYTES);
    expect(item.warning).toMatch(/truncated/);
  });
});

describe("assemble", () => {
  it("numbers PPTX slides and XLSX sheets", () => {
    const deck = assemble(
      "pptx",
      {
        ok: true,
        title: null,
        markdown:
          "<!-- Slide number: 1 -->\n# A\n\n<!-- Slide number: 2 -->\n# B",
      },
      { ocr: true },
    );
    expect(deck.pageCount).toBe(2);
    expect(deck.title).toBe("A");
    expect(deck.segments.map((s) => s.page)).toEqual([1, 2]);
  });

  it("warns about page and OCR limits", () => {
    const doc = assemble(
      "pdf",
      {
        ok: true,
        title: "T",
        pages: [{ text: "x", ocr: false }],
        pageCount: 9,
        ocrSkipped: 3,
      },
      { ocr: false },
    );
    expect(doc.warnings.join(" ")).toMatch(
      /first 1 of 9 pages.*3 page\(s\) have no text layer/,
    );
  });
});
