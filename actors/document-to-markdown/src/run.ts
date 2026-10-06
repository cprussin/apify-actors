import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chunkSegments } from "./chunk.js";
import type { Convert, ConvertResult } from "./converter.js";
import { charsetOf, detectType, type DocType } from "./detect.js";
import { DocumentError, type Fetched } from "./download.js";
import type { NormalizedInput, OutputFormat, Source } from "./input.js";
import {
  firstHeading,
  normalizeMarkdown,
  segmentsOf,
  toPlainText,
  wordCount,
  type Segment,
} from "./markdown.js";

/** One dataset item: a whole document, one chunk of it, or a failure. */
export interface OutputItem {
  /** The document URL, or "storeId/key" for a key-value store record. */
  url: string;
  fileName: string | null;
  fileType: DocType | null;
  title: string | null;
  outputFormat: OutputFormat;
  /** Markdown, plain text or the chunk's Markdown; null on failure. */
  content: string | null;
  chunkIndex: number | null;
  chunkCount: number | null;
  pageStart: number | null;
  pageEnd: number | null;
  heading: string | null;
  pageCount: number | null;
  ocrPages: number;
  bytes: number | null;
  charCount: number | null;
  wordCount: number | null;
  /** Link to the full content when it was too large for a dataset item. */
  contentUrl: string | null;
  warning: string | null;
  error: string | null;
  convertedAt: string;
}

export interface EmitResult {
  pushed: boolean;
  more: boolean;
}

export interface Charge {
  /** Charge one document-converted event (successful documents only). */
  document: boolean;
  ocrPages: number;
}

export interface RunDeps {
  fetch: (source: Exclude<Source, { kind: "invalid" }>) => Promise<Fetched>;
  convert: Convert;
  /** Max OCR pages the remaining budget allows after one more document. */
  ocrBudget: () => number;
  /** False when the budget can't pay for another document. */
  canConvert: () => boolean;
  /**
   * Push one document's items, charging for them. `pushed: false` when the
   * budget was used up; `more: false` to stop.
   */
  emit: (items: OutputItem[], charge: Charge) => Promise<EmitResult>;
  /** Stores oversized content; returns its public URL. */
  saveContent?: (
    key: string,
    text: string,
    contentType: string,
  ) => Promise<string>;
  log?: (msg: string) => void;
  now?: () => Date;
}

export interface RunStats {
  converted: number;
  failed: number;
  skipped: number;
  ocrPages: number;
  items: number;
  stopReason: "done" | "budget";
}

/** Dataset items max out at 9 MB; larger content goes to the KV store. */
export const MAX_ITEM_CONTENT_BYTES = 5 * 1024 * 1024;
export const TRUNCATED_CHARS = 1_000_000;

const errMsg = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 500);

/** Map with at most `limit` calls in flight. `fn` returning false stops. */
export async function forEachLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<boolean>,
): Promise<number> {
  let next = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && next < items.length) {
      const item = items[next++]!;
      if (!(await fn(item))) stopped = true;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return items.length - next;
}

/** Runs `fn` calls one at a time, in call order. */
function serializer() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => {});
    return run;
  };
}

/** Conversion timeout: generous base plus time per OCR page. */
export const convertTimeoutMs = (ocrPages: number) =>
  Math.min(3600, 300 + 20 * ocrPages) * 1000;

export interface Converted {
  title: string | null;
  markdown: string;
  segments: Segment[];
  pageCount: number | null;
  ocrPages: number;
  warnings: string[];
}

/** Turns converter output into Markdown and page-numbered segments. */
export function assemble(
  type: DocType,
  res: Extract<ConvertResult, { ok: true }>,
  opts: { ocr: boolean },
): Converted {
  const warnings: string[] = [];
  if ("pages" in res) {
    const segments = res.pages.map((p, i) => ({
      page: i + 1,
      markdown: normalizeMarkdown(p.text),
    }));
    if (res.pageCount > res.pages.length)
      warnings.push(
        `Only the first ${res.pages.length} of ${res.pageCount} pages were converted (maxPagesPerDocument).`,
      );
    if (res.ocrSkipped)
      warnings.push(
        opts.ocr
          ? `${res.ocrSkipped} page(s) without a text layer were not OCR'd (maxOcrPagesPerDocument or max charge reached).`
          : `${res.ocrSkipped} page(s) have no text layer (scanned?). Turn on OCR to read them.`,
      );
    const markdown = segments
      .map((s) => s.markdown)
      .filter(Boolean)
      .join("\n\n");
    return {
      title: res.title || firstHeading(markdown),
      markdown,
      segments,
      pageCount: res.pageCount,
      ocrPages: res.pages.filter((p) => p.ocr).length,
      warnings,
    };
  }
  const markdown = normalizeMarkdown(res.markdown);
  const segments = segmentsOf(type, markdown);
  const numbered = segments.filter((s) => s.page !== null).length;
  return {
    title: res.title?.trim() || firstHeading(markdown),
    markdown,
    segments,
    pageCount: numbered || null,
    ocrPages: 0,
    warnings,
  };
}

export async function runConversions(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const serial = serializer();
  const stats: RunStats = {
    converted: 0,
    failed: 0,
    skipped: 0,
    ocrPages: 0,
    items: 0,
    stopReason: "done",
  };
  const tmp = await mkdtemp(join(tmpdir(), "doc2md-"));

  const base = (s: Source): OutputItem => ({
    url: s.kind === "url" ? s.url : s.input,
    fileName: null,
    fileType: null,
    title: null,
    outputFormat: input.outputFormat,
    content: null,
    chunkIndex: null,
    chunkCount: null,
    pageStart: null,
    pageEnd: null,
    heading: null,
    pageCount: null,
    ocrPages: 0,
    bytes: null,
    charCount: null,
    wordCount: null,
    contentUrl: null,
    warning: null,
    error: null,
    convertedAt: now().toISOString(),
  });

  const failure = async (
    s: Source,
    error: string,
    extra: Partial<OutputItem> = {},
  ) => {
    stats.failed += 1;
    log(`${s.input}: ${error}`);
    const res = await deps.emit([{ ...base(s), ...extra, error }], {
      document: false,
      ocrPages: 0,
    });
    if (res.pushed) stats.items += 1;
    return res.more;
  };

  // Returns false to stop the run (budget used up).
  const convertOne = async (
    s: Exclude<Source, { kind: "invalid" }>,
    file: Fetched,
    type: DocType,
  ): Promise<boolean> => {
    const meta: Partial<OutputItem> = {
      fileName: file.fileName,
      fileType: type,
      bytes: file.body.length,
    };
    if (!deps.canConvert()) {
      stats.stopReason = "budget";
      return false;
    }
    const maxOcrPages =
      input.ocr && type === "pdf"
        ? Math.max(0, Math.min(input.maxOcrPagesPerDocument, deps.ocrBudget()))
        : 0;
    const path = join(tmp, `doc-${s.index}`);
    let res: ConvertResult;
    try {
      await writeFile(path, file.body);
      res = await deps.convert(
        {
          path,
          type,
          charset: charsetOf(file.contentType),
          ocr: input.ocr,
          ocrLanguage: input.ocrLanguage,
          maxOcrPages,
          maxPages: input.maxPagesPerDocument,
        },
        convertTimeoutMs(maxOcrPages),
      );
    } catch (e) {
      res = { ok: false, error: `Conversion failed: ${errMsg(e)}` };
    } finally {
      await rm(path, { force: true }).catch(() => {});
    }
    if (!res.ok) return failure(s, res.error, meta);

    const doc = assemble(type, res, { ocr: input.ocr });
    const plain = toPlainText(doc.markdown);
    if (!plain.trim())
      return failure(
        s,
        doc.warnings.length
          ? `No text found. ${doc.warnings.join(" ")}`
          : "No text found in the document.",
        { ...meta, title: doc.title, pageCount: doc.pageCount },
      );

    const common: OutputItem = {
      ...base(s),
      ...meta,
      title: doc.title,
      pageCount: doc.pageCount,
      ocrPages: doc.ocrPages,
    };
    const warnings = [...doc.warnings];
    let items: OutputItem[];
    if (input.outputFormat === "chunks") {
      const chunks = chunkSegments(doc.segments, {
        size: input.chunkSize,
        overlap: input.chunkOverlap,
      });
      const warning = warnings.join(" ") || null;
      items = chunks.map((c, i) => ({
        ...common,
        content: c.text,
        chunkIndex: i,
        chunkCount: chunks.length,
        pageStart: c.pageStart,
        pageEnd: c.pageEnd,
        heading: c.heading,
        charCount: c.text.length,
        wordCount: wordCount(c.text),
        warning,
      }));
    } else {
      const text = input.outputFormat === "text" ? plain : doc.markdown;
      let content = text;
      let contentUrl: string | null = null;
      if (
        Buffer.byteLength(text) > MAX_ITEM_CONTENT_BYTES &&
        deps.saveContent
      ) {
        const ext = input.outputFormat === "text" ? "txt" : "md";
        contentUrl = await deps.saveContent(
          `document-${String(s.index + 1).padStart(4, "0")}.${ext}`,
          text,
          input.outputFormat === "text"
            ? "text/plain; charset=utf-8"
            : "text/markdown; charset=utf-8",
        );
        content = text.slice(0, TRUNCATED_CHARS);
        warnings.push(
          "The content is too large for one dataset item and is truncated here; the full file is at contentUrl.",
        );
      }
      items = [
        {
          ...common,
          content,
          charCount: text.length,
          wordCount: wordCount(plain),
          contentUrl,
          warning: warnings.join(" ") || null,
        },
      ];
    }

    const emitted = await deps.emit(items, {
      document: true,
      ocrPages: doc.ocrPages,
    });
    if (emitted.pushed) {
      stats.converted += 1;
      stats.ocrPages += doc.ocrPages;
      stats.items += items.length;
    }
    if (!emitted.more) stats.stopReason = "budget";
    return emitted.more;
  };

  const one = async (s: Source): Promise<boolean> => {
    if (s.kind === "invalid") return failure(s, s.error);
    let file: Fetched;
    try {
      file = await deps.fetch(s);
    } catch (e) {
      return failure(
        s,
        e instanceof DocumentError
          ? e.message
          : `Download failed: ${errMsg(e)}`,
      );
    }
    if (file.body.length > input.maxBytes)
      return failure(
        s,
        `The file is larger than the ${input.maxBytes / 1024 / 1024} MB limit (maxFileSizeMb).`,
      );
    const det = detectType(
      file.body,
      file.contentType,
      file.fileName ?? (s.kind === "url" ? s.url : s.key),
    );
    if (det.type === null)
      return failure(s, det.error, {
        fileName: file.fileName,
        bytes: file.body.length,
      });
    // Downloads run in parallel; conversion and charging one at a time.
    return serial(() => convertOne(s, file, det.type!));
  };

  try {
    stats.skipped = await forEachLimit(
      input.sources,
      input.maxConcurrency,
      one,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
  return stats;
}
