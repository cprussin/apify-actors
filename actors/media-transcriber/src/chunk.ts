import type { Segment } from "./captions.js";

export interface Chunk {
  text: string;
  /** Seconds from the start of the media, overlap included. */
  start: number;
  end: number;
}

export interface ChunkOptions {
  /** Max characters per chunk, including overlap. */
  size: number;
  /** Max characters of whole segments repeated from the previous chunk. */
  overlap: number;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Splits an oversized segment at word boundaries into parts of at most `max`
 * characters, interpolating their timestamps by character offset.
 */
export function splitSegment(seg: Segment, max: number): Segment[] {
  const text = seg.text.trim();
  if (text.length <= max) return [{ ...seg, text }];
  const words = text.split(/(?<=\s)/);
  const parts: string[] = [];
  let cur = "";
  for (let w of words) {
    while (w.length > max) {
      if (cur.trim()) parts.push(cur);
      cur = "";
      parts.push(w.slice(0, max));
      w = w.slice(max);
    }
    if (cur.length + w.length > max && cur.trim()) {
      parts.push(cur);
      cur = "";
    }
    cur += w;
  }
  if (cur.trim()) parts.push(cur);
  const span = seg.end - seg.start;
  let offset = 0;
  return parts.map((p) => {
    const start = seg.start + (span * offset) / text.length;
    offset += p.length;
    return {
      start: round(start),
      end: round(seg.start + (span * offset) / text.length),
      text: p.trim(),
    };
  });
}

/**
 * Packs consecutive segments into chunks of at most `size` characters
 * (segments joined with a space), each with the start of its first and the
 * end of its last segment. Chunks after the first start with the previous
 * chunk's trailing segments, up to `overlap` characters.
 */
export function chunkSegments(
  segments: Segment[],
  { size, overlap }: ChunkOptions,
): Chunk[] {
  // Room for new content; the overlap is joined with a space.
  const room = size - (overlap > 0 ? overlap + 1 : 0);
  const pieces = segments
    .filter((s) => s.text.trim())
    .flatMap((s) => splitSegment(s, room));
  const chunks: Chunk[] = [];
  let cur: Segment[] = [];
  let len = 0;
  let prev: Segment[] = [];
  const flush = () => {
    if (!cur.length) return;
    const lead: Segment[] = [];
    let leadLen = 0;
    for (let i = prev.length - 1; i >= 0 && overlap > 0; i--) {
      const add = prev[i]!.text.length + (lead.length ? 1 : 0);
      if (leadLen + add > overlap) break;
      lead.unshift(prev[i]!);
      leadLen += add;
    }
    const all = [...lead, ...cur];
    chunks.push({
      text: all.map((s) => s.text).join(" "),
      start: all[0]!.start,
      end: Math.max(...all.map((s) => s.end)),
    });
    prev = cur;
    cur = [];
    len = 0;
  };
  for (const p of pieces) {
    const add = (cur.length ? 1 : 0) + p.text.length;
    if (len + add > room) flush();
    len += (cur.length ? 1 : 0) + p.text.length;
    cur.push(p);
  }
  flush();
  return chunks;
}
