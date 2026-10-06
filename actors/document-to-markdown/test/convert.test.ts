/**
 * End-to-end conversion through the real Python worker (markitdown +
 * Tesseract) on tiny generated fixtures. Skipped when the Python side isn't
 * installed; set DOC2MD_PYTHON to a venv with requirements.txt to run it.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PythonWorker } from "../src/converter.js";
import { normalizeInput } from "../src/input.js";
import { runConversions, type OutputItem } from "../src/run.js";

const python = process.env.DOC2MD_PYTHON ?? "python3";
const hasPython =
  spawnSync(python, ["-c", "import markitdown, pdfplumber, pptx, openpyxl"], {
    stdio: "ignore",
  }).status === 0;
const hasTesseract =
  spawnSync("tesseract", ["--list-langs"], { stdio: "ignore" }).status === 0;

describe.skipIf(!hasPython)("Python converter", () => {
  let dir: string;
  let worker: PythonWorker;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "doc2md-fixtures-"));
    execFileSync(python, [
      join(import.meta.dirname, "fixtures/make_fixtures.py"),
      dir,
    ]);
    worker = new PythonWorker(python);
  }, 120_000);

  afterAll(() => {
    worker?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  async function convert(
    names: string[],
    raw: Record<string, unknown> = {},
  ): Promise<OutputItem[]> {
    const input = normalizeInput({
      urls: names.map((n) => `https://fixtures.test/${n}`),
      maxConcurrency: 1,
      ...raw,
    });
    const items: OutputItem[] = [];
    await runConversions(input, {
      fetch: async (s) => {
        const name = s.kind === "url" ? s.url.split("/").pop()! : s.key;
        return {
          body: readFileSync(join(dir, name)),
          contentType: null,
          fileName: name,
        };
      },
      convert: worker.convert,
      canConvert: () => true,
      ocrBudget: () => Infinity,
      emit: async (batch) => {
        items.push(...batch);
        return { pushed: true, more: true };
      },
    });
    return items;
  }

  it("converts every format, with Markdown tables", async () => {
    const items = await convert([
      "text.pdf",
      "table.docx",
      "deck.pptx",
      "book.xlsx",
      "page.html",
      "book.epub",
    ]);
    const by = Object.fromEntries(items.map((i) => [i.fileName, i]));
    for (const i of items) expect(i.error, i.fileName!).toBeNull();

    expect(by["text.pdf"]).toMatchObject({ fileType: "pdf", pageCount: 2 });
    expect(by["text.pdf"]!.content).toContain("Revenue grew in every region");
    expect(by["text.pdf"]!.content).toContain("Costs were flat");

    expect(by["table.docx"]!.content).toBe(
      "# Sales summary\n\nRevenue by region:\n\n| Region | Revenue |\n| --- | --- |\n| EU | 120 |\n| US | 340 |",
    );
    expect(by["deck.pptx"]).toMatchObject({
      pageCount: 2,
      title: "Slide title 1",
    });
    expect(by["deck.pptx"]!.content).toContain(
      "Point 2\n\n| Plan | Price |\n| --- | --- |\n| Pro | 9 |",
    );
    expect(by["book.xlsx"]).toMatchObject({ pageCount: 2 });
    expect(by["book.xlsx"]!.content).toContain(
      "## Costs\n\n| Item | Amount |\n| --- | --- |\n| Rent | 2 |",
    );
    expect(by["page.html"]).toMatchObject({ title: "Price list" });
    expect(by["page.html"]!.content).toContain("| Item | Price |");
    expect(by["book.epub"]).toMatchObject({ title: "Tiny Book" });
    expect(by["book.epub"]!.content).toContain("# Chapter One");
  }, 120_000);

  it("chunks with page numbers", async () => {
    const items = await convert(["text.pdf", "deck.pptx"], {
      outputFormat: "chunks",
      chunkSize: 200,
      chunkOverlap: 0,
    });
    const pdf = items.filter((i) => i.fileName === "text.pdf");
    expect(pdf.map((c) => [c.pageStart, c.pageEnd])).toEqual([[1, 2]]);
    const deck = items.filter((i) => i.fileName === "deck.pptx");
    expect(deck[0]).toMatchObject({ pageStart: 1, pageEnd: 2, chunkCount: 1 });
  }, 120_000);

  it.skipIf(!hasTesseract)(
    "OCRs scanned pages only when enabled",
    async () => {
      const [on] = await convert(["scanned.pdf"]);
      expect(on).toMatchObject({ ocrPages: 1, error: null });
      expect(on!.content).toMatch(/Scanned invoice/i);
      expect(on!.content).toMatch(/1250/);

      const [off] = await convert(["scanned.pdf"], { ocr: false });
      expect(off!.error).toMatch(/no text layer.*Turn on OCR/);
      expect(off!.ocrPages).toBe(0);
    },
    120_000,
  );

  it("reports corrupt files without crashing the worker", async () => {
    const items = await convert(["text.pdf"], {});
    expect(items[0]!.error).toBeNull();
    const bad = await worker.convert(
      {
        path: join(dir, "page.html"),
        type: "docx",
        ocr: false,
        ocrLanguage: "eng",
        maxOcrPages: 0,
        maxPages: 10,
      },
      60_000,
    );
    expect(bad).toMatchObject({
      ok: false,
      error: expect.stringMatching(/corrupt/),
    });
    const again = await convert(["page.html"]);
    expect(again[0]!.error).toBeNull();
  }, 120_000);
});
