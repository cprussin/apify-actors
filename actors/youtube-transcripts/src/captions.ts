/** Parsing of YouTube timedtext XML and rendering to text / SRT / WebVTT. */

export interface Segment {
  /** Start time in seconds. */
  start: number;
  /** Duration in seconds. */
  duration: number;
  text: string;
}

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n =
        code[1] === "x" || code[1] === "X"
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff
        ? String.fromCodePoint(n)
        : m;
    }
    return NAMED[code.toLowerCase()] ?? m;
  });
}

/** XML-decode, strip inline formatting tags, then HTML-decode (YouTube double-escapes). */
export function cleanCaptionText(raw: string): string {
  const once = decodeEntities(raw).replace(/<[^>]*>/g, "");
  return decodeEntities(once).replace(/\s+/g, " ").trim();
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Parse the default (srv1) timedtext format: `<transcript><text start dur>..</text></transcript>`. */
export function parseTimedText(xml: string): Segment[] {
  const out: Segment[] = [];
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>|<text\b([^>]*)\/>/g;
  for (const m of xml.matchAll(re)) {
    const attrs = m[1] ?? m[3] ?? "";
    const start = Number(/\bstart="([\d.]+)"/.exec(attrs)?.[1]);
    const dur = Number(/\bdur="([\d.]+)"/.exec(attrs)?.[1] ?? 0);
    if (!Number.isFinite(start)) continue;
    const text = cleanCaptionText(m[2] ?? "");
    if (!text) continue;
    out.push({
      start: round(start),
      duration: round(Number.isFinite(dur) ? dur : 0),
      text,
    });
  }
  return out;
}

export const segmentsToText = (segments: Segment[]): string =>
  segments.map((s) => s.text).join(" ");

/** End time of segment i, clipped to the next segment's start (auto captions overlap). */
function endOf(segments: Segment[], i: number): number {
  const s = segments[i]!;
  let end = s.start + s.duration;
  const next = segments[i + 1];
  if (next && next.start > s.start && next.start < end) end = next.start;
  if (end <= s.start) end = s.start + 0.001;
  return end;
}

export function formatTimestamp(sec: number, sep: "," | "."): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

export function toSrt(segments: Segment[]): string {
  return segments
    .map(
      (s, i) =>
        `${i + 1}\n${formatTimestamp(s.start, ",")} --> ${formatTimestamp(endOf(segments, i), ",")}\n${s.text}\n`,
    )
    .join("\n");
}

export function toVtt(segments: Segment[]): string {
  const cues = segments.map(
    (s, i) =>
      `${formatTimestamp(s.start, ".")} --> ${formatTimestamp(endOf(segments, i), ".")}\n${s.text}\n`,
  );
  return ["WEBVTT\n", ...cues].join("\n");
}
