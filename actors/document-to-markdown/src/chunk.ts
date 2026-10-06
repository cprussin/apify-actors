import type { Segment } from "./markdown.js";

export interface Chunk {
  text: string;
  /** First and last page (PDF page, slide or sheet) the chunk covers. */
  pageStart: number | null;
  pageEnd: number | null;
  /** The nearest Markdown heading above the chunk's start. */
  heading: string | null;
}

export interface ChunkOptions {
  /** Max characters per chunk, including overlap. */
  size: number;
  /** Characters repeated from the end of the previous chunk. */
  overlap: number;
}

/** A unit that is never split further (unless it alone exceeds the size). */
interface Piece {
  text: string;
  page: number | null;
  heading: string | null;
}

const HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const isTableLine = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isSeparatorRow = (l: string) => /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(l);

/** Hard-splits text at word boundaries into parts of at most `max` chars. */
export function splitText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  // Prefer line breaks, then sentence ends, then spaces.
  const units = text
    .split(/(?<=\n)/)
    .flatMap((l) => (l.length <= max ? [l] : l.split(/(?<=[.!?。]\s+)/)))
    .flatMap((s) => (s.length <= max ? [s] : s.split(/(?<=\s)/)));
  let cur = "";
  for (let u of units) {
    while (u.length > max) {
      // A single "word" longer than the limit (e.g. a URL or base64).
      if (cur) out.push(cur.trimEnd());
      cur = "";
      out.push(u.slice(0, max));
      u = u.slice(max);
    }
    if (cur.length + u.length > max && cur) {
      out.push(cur.trimEnd());
      cur = "";
    }
    cur += u;
  }
  if (cur.trim()) out.push(cur.trimEnd());
  return out.filter((s) => s.trim());
}

/** Splits a Markdown table into row groups, each repeating the header. */
function splitTable(lines: string[], max: number): string[] {
  const hasHeader = lines.length > 1 && isSeparatorRow(lines[1]!);
  const header = hasHeader ? lines.slice(0, 2) : [];
  const rows = hasHeader ? lines.slice(2) : lines;
  const headerText = header.join("\n");
  const room = max - headerText.length - 1;
  if (room < max / 4) return splitText(lines.join("\n"), max);
  const out: string[] = [];
  let cur: string[] = [];
  let len = 0;
  const flush = () => {
    if (cur.length) out.push([...header, ...cur].join("\n"));
    cur = [];
    len = 0;
  };
  for (const row of rows) {
    if (row.length > room) {
      flush();
      for (const part of splitText(row, max)) out.push(part);
      continue;
    }
    if (len + row.length + 1 > room) flush();
    cur.push(row);
    len += row.length + 1;
  }
  flush();
  return out;
}

/** Paragraphs and whole tables, tagged with their page and heading. */
function toPieces(segments: Segment[], max: number): Piece[] {
  const pieces: Piece[] = [];
  let heading: string | null = null;
  for (const seg of segments) {
    const text = seg.markdown.replace(/<!--[\s\S]*?-->/g, "");
    const blocks: string[][] = [];
    let cur: string[] = [];
    let inTable = false;
    for (const line of text.split("\n")) {
      const table = isTableLine(line);
      if (!line.trim() || table !== inTable || HEADING.test(line)) {
        if (cur.length) blocks.push(cur);
        cur = [];
      }
      inTable = table;
      if (line.trim()) cur.push(line);
      if (HEADING.test(line)) {
        blocks.push(cur);
        cur = [];
      }
    }
    if (cur.length) blocks.push(cur);
    for (const lines of blocks) {
      const h = HEADING.exec(lines[0]!);
      if (h && lines.length === 1) heading = h[1]!;
      const block = lines.join("\n");
      const parts =
        block.length <= max
          ? [block]
          : isTableLine(lines[0]!)
            ? splitTable(lines, max)
            : splitText(block, max);
      for (const p of parts) pieces.push({ text: p, page: seg.page, heading });
    }
  }
  return pieces;
}

/** The last `n` chars of `text`, starting at a word boundary. */
function tail(text: string, n: number): string {
  if (n <= 0) return "";
  if (text.length <= n) return text;
  const t = text.slice(-n);
  const ws = t.search(/\s/);
  return ws < 0 ? t : t.slice(ws).trimStart();
}

/**
 * Packs paragraphs and tables into chunks of at most `size` characters,
 * splitting only oversized blocks (tables by row, repeating the header). Each
 * chunk after the first starts with up to `overlap` characters from the end
 * of the previous one.
 */
export function chunkSegments(
  segments: Segment[],
  { size, overlap }: ChunkOptions,
): Chunk[] {
  // Room for new content; the overlap is joined with a blank line.
  const room = size - (overlap > 0 ? overlap + 2 : 0);
  const pieces = toPieces(segments, room);
  const chunks: Chunk[] = [];
  let cur: Piece[] = [];
  let len = 0;
  let prevText = "";
  const flush = () => {
    if (!cur.length) return;
    const body = cur.map((p) => p.text).join("\n\n");
    const lead = tail(prevText, overlap);
    const pages = cur.map((p) => p.page).filter((p) => p !== null);
    chunks.push({
      text: lead ? `${lead}\n\n${body}` : body,
      pageStart: pages.length ? Math.min(...pages) : null,
      pageEnd: pages.length ? Math.max(...pages) : null,
      heading: cur[0]!.heading,
    });
    prevText = body;
    cur = [];
    len = 0;
  };
  for (const p of pieces) {
    const add = (cur.length ? 2 : 0) + p.text.length;
    if (len + add > room) flush();
    cur.push(p);
    len += (cur.length > 1 ? 2 : 0) + p.text.length;
  }
  flush();
  return chunks;
}
