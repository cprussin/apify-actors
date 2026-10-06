import type { DocType } from "./detect.js";

/** A part of a document with a page (PDF page, slide or sheet number). */
export interface Segment {
  page: number | null;
  markdown: string;
}

const isTableLine = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isSeparatorRow = (l: string) => /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(l);

/**
 * Tidies converter output: blank line before and after tables (markitdown
 * glues PPTX tables to the preceding text, which breaks rendering), no
 * trailing spaces, at most one empty line in a row.
 */
export function normalizeMarkdown(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/[ \t]+$/, "");
    const prev = out.at(-1);
    if (
      prev !== undefined &&
      prev !== "" &&
      isTableLine(line) !== isTableLine(prev)
    )
      out.push("");
    if (line === "" && (prev === "" || prev === undefined)) continue;
    out.push(line);
  }
  while (out.at(-1) === "") out.pop();
  return promoteHeaders(out).join("\n");
}

const isEmptyRow = (l: string) => /^\s*\|(\s*\|)+\s*$/.test(l);

/**
 * Tables without header cells (common in DOCX) come out with an empty header
 * row; use the first data row as the header instead.
 */
function promoteHeaders(lines: string[]): string[] {
  const out = [...lines];
  for (let i = 0; i + 2 < out.length; i++) {
    if (
      (i === 0 || !isTableLine(out[i - 1]!)) &&
      isEmptyRow(out[i]!) &&
      isSeparatorRow(out[i + 1]!) &&
      isTableLine(out[i + 2]!) &&
      !isSeparatorRow(out[i + 2]!)
    ) {
      out[i] = out[i + 2]!;
      out.splice(i + 2, 1);
    }
  }
  return out;
}

const stripInline = (s: string) =>
  s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^\w_])_(?!\s)([^_\n]+?)_(?!\w)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1");

/** Markdown -> plain text: no syntax, table rows as tab-separated cells. */
export function toPlainText(md: string): string {
  const out: string[] = [];
  for (const line of md.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) continue;
    if (isSeparatorRow(line)) continue;
    if (/^\s*([-*_]\s*){3,}$/.test(line)) continue;
    if (isTableLine(line)) {
      const cells = line.trim().slice(1, -1).split("|");
      out.push(cells.map((c) => stripInline(c.trim())).join("\t"));
      continue;
    }
    out.push(
      stripInline(
        line
          .replace(/^\s{0,3}#{1,6}\s+/, "")
          .replace(/^\s*>\s?/, "")
          .replace(/^(\s*)[-*+]\s+/, "$1"),
      ),
    );
  }
  return normalizeMarkdown(out.join("\n"));
}

/** Text of the first Markdown heading, if any. */
export function firstHeading(md: string): string | null {
  const m = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m.exec(md);
  return m ? stripInline(m[1]!).trim() || null : null;
}

export const wordCount = (s: string): number =>
  (s.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;

/**
 * Splits converter output into page-numbered segments: one per PPTX slide
 * (markitdown's "<!-- Slide number: N -->" markers) and one per XLSX sheet
 * ("## Sheet" headings, numbered from 1). Other types are one segment.
 */
export function segmentsOf(type: DocType, md: string): Segment[] {
  if (type === "pptx") {
    const parts = md.split(/^<!-- Slide number: (\d+) -->[ \t]*(?:\n|$)/m);
    const segs: Segment[] = [];
    if (parts[0]!.trim()) segs.push({ page: null, markdown: parts[0]! });
    for (let i = 1; i + 1 < parts.length; i += 2)
      segs.push({ page: Number(parts[i]), markdown: parts[i + 1]! });
    return segs;
  }
  if (type === "xlsx") {
    const parts = md.split(/^(?=## )/m);
    const segs: Segment[] = [];
    let sheet = 0;
    for (const p of parts) {
      if (p.startsWith("## ")) sheet += 1;
      if (p.trim()) segs.push({ page: sheet || null, markdown: p });
    }
    return segs;
  }
  return [{ page: null, markdown: md }];
}
