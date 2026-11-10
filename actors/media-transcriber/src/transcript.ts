/**
 * Podcasting 2.0 published transcripts (<podcast:transcript>): WebVTT, SRT,
 * the JSON format of the podcast namespace, plain text and HTML, normalized
 * to the actor's segments.
 */
import * as cheerio from "cheerio";
import type { Segment } from "./captions.js";

export type TranscriptKind = "vtt" | "srt" | "json" | "text" | "html";

export interface PublishedTranscript {
  url: string;
  kind: TranscriptKind;
  /** Primary language subtag from the tag's language attribute. */
  language: string | null;
}

export interface ParsedTranscript {
  /** Timed segments, or untimed paragraphs (start = end = 0). */
  segments: Segment[];
  /** Whether segments carry real timestamps. */
  timed: boolean;
}

/** MIME type of a <podcast:transcript> -> kind, or null when unsupported. */
export function transcriptKind(
  type: string | null | undefined,
): TranscriptKind | null {
  const t = (type ?? "").split(";")[0]!.trim().toLowerCase();
  if (t === "text/vtt") return "vtt";
  if (["application/x-subrip", "application/srt", "text/srt"].includes(t))
    return "srt";
  if (t === "application/json") return "json";
  if (t === "text/plain") return "text";
  if (t === "text/html") return "html";
  return null;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** "01:02:03.456", "1:02:03,4" or "02:03.456" -> seconds. */
export function parseCueTime(raw: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(
    raw.trim(),
  );
  if (!m) return null;
  const frac = m[4] ? Number(`0.${m[4]}`) : 0;
  return round(
    Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + frac,
  );
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const decodeEntities = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const n =
        e[1] === "x" || e[1] === "X"
          ? parseInt(e.slice(2), 16)
          : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** WebVTT and SRT cues (one parser: the cue syntax is nearly the same). */
export function parseCues(body: string): Segment[] {
  const segments: Segment[] = [];
  const blocks = body
    .replace(/^\uFEFF/, "")
    .split(/\r?\n\s*\r?\n|\r\s*\r/)
    .map((b) => b.split(/\r\n|\r|\n/));
  for (const lines of blocks) {
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0 || at > 1) continue; // Header, NOTE, STYLE, REGION blocks.
    const [a, b] = lines[at]!.split("-->");
    const start = parseCueTime(a!);
    // Cue settings ("align:start") follow the end time.
    const end = parseCueTime((b ?? "").trim().split(/\s+/)[0] ?? "");
    if (start === null || end === null) continue;
    let speaker: string | undefined;
    const text = squash(
      decodeEntities(
        lines
          .slice(at + 1)
          .join(" ")
          .replace(/<v(?:\.[^\s>]*)?\s+([^>]+)>/gi, (_, name: string) => {
            speaker ??= name.trim();
            return "";
          })
          .replace(/<[^>]*>/g, ""),
      ),
    );
    if (!text) continue;
    segments.push({
      start,
      end: Math.max(end, start),
      text,
      ...(speaker ? { speaker } : {}),
    });
  }
  return segments;
}

interface JsonSegment {
  startTime?: unknown;
  endTime?: unknown;
  body?: unknown;
  speaker?: unknown;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Segments longer than this (seconds or characters) aren't merged into. */
const MERGE_SECS = 15;
const MERGE_CHARS = 300;

/**
 * The podcast namespace JSON format: {"segments": [{startTime, endTime,
 * body, speaker}]}. Word-level segments are merged into sentence-sized ones
 * (same speaker, no long pause).
 */
export function parseJsonTranscript(body: string): Segment[] {
  const data = JSON.parse(body.replace(/^\uFEFF/, "")) as
    { segments?: unknown } | JsonSegment[];
  const raw = Array.isArray(data) ? data : data?.segments;
  if (!Array.isArray(raw)) throw new Error("no segments array");
  const out: (Segment & { speaker?: string })[] = [];
  let lastSpeaker: string | undefined;
  for (const r of raw as JsonSegment[]) {
    const start = num(r?.startTime);
    const end = num(r?.endTime);
    const text = typeof r?.body === "string" ? squash(r.body) : "";
    if (start === null || !text) continue;
    const speaker =
      typeof r.speaker === "string" && r.speaker.trim()
        ? r.speaker.trim()
        : lastSpeaker;
    lastSpeaker = speaker;
    const seg = {
      start: round(start),
      end: round(Math.max(end ?? start, start)),
      text,
    };
    const prev = out.at(-1);
    if (
      prev &&
      prev.speaker === speaker &&
      start - prev.end < 1.5 &&
      seg.end - prev.start <= MERGE_SECS &&
      prev.text.length + text.length < MERGE_CHARS &&
      !/[.!?…]["')\]]?$/.test(prev.text)
    ) {
      prev.text = /^[,.;:!?…'")\]]/.test(text)
        ? `${prev.text}${text}`
        : `${prev.text} ${text}`;
      prev.end = Math.max(prev.end, seg.end);
      continue;
    }
    out.push({ ...seg, ...(speaker ? { speaker } : {}) });
  }
  return out;
}

const STAMP = /^\[?\(?((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\)?\]?$/;

/**
 * Plain text: paragraphs, untimed. When paragraphs start with a timestamp
 * line ("00:00:01" then "Speaker 1: text"), they become timed segments
 * (each ending where the next starts).
 */
export function parsePlainTranscript(body: string): ParsedTranscript {
  const paras = body
    .replace(/^\uFEFF/, "")
    .split(/\r?\n\s*\r?\n|\r\s*\r/)
    .map((p) => p.split(/\r\n|\r|\n/).map((l) => l.trim()))
    .filter((p) => p.some(Boolean));
  const stamped = paras.map((lines) => {
    const m = STAMP.exec(lines[0] ?? "");
    const start = m ? parseCueTime(m[1]!) : null;
    return {
      start,
      text: squash((start !== null ? lines.slice(1) : lines).join(" ")),
    };
  });
  const timed =
    stamped.length >= 2 &&
    stamped.filter((s) => s.start !== null).length >= stamped.length * 0.8;
  if (!timed)
    return {
      timed: false,
      segments: paras
        .map((p) => squash(p.join(" ")))
        .filter(Boolean)
        .map((text) => ({ start: 0, end: 0, text })),
    };
  const kept = stamped.filter(
    (s): s is { start: number; text: string } => s.start !== null && !!s.text,
  );
  return {
    timed: true,
    segments: kept.map((s, i) => {
      const next = kept[i + 1]?.start;
      return {
        start: s.start,
        end: next !== undefined && next > s.start ? next : s.start,
        text: s.text,
      };
    }),
  };
}

/** HTML: the text of block elements, as untimed (or stamped) paragraphs. */
export function parseHtmlTranscript(body: string): ParsedTranscript {
  const $ = cheerio.load(body);
  $("script, style, noscript, head, nav, header, footer").remove();
  $("br").replaceWith("\n");
  $(
    "p, div, li, h1, h2, h3, h4, h5, h6, blockquote, section, article, tr",
  ).each((_, el) => {
    $(el).prepend("\n\n").append("\n\n");
  });
  const text: string = $("body").text() || $.root().text();
  // Collapse runs inside a line; keep paragraph breaks.
  const normalized = text
    .split(/\n\s*\n/)
    .map((p: string) => p.replace(/[^\S\n]+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
  return parsePlainTranscript(normalized);
}

/**
 * Parses a published transcript of the declared kind. Throws when the body
 * isn't one (e.g. an HTML error page for a VTT link) or has no text.
 */
export function parsePublishedTranscript(
  body: string,
  kind: TranscriptKind,
): ParsedTranscript {
  const looksHtml =
    /^\s*(<!doctype html|<html[\s>]|<head[\s>]|<body[\s>])/i.test(body);
  if (looksHtml && kind !== "html")
    throw new Error("the transcript link returned a web page");
  let parsed: ParsedTranscript;
  switch (kind) {
    case "vtt":
    case "srt":
      parsed = { segments: parseCues(body), timed: true };
      break;
    case "json":
      parsed = { segments: parseJsonTranscript(body), timed: true };
      break;
    case "text":
      parsed = parsePlainTranscript(body);
      break;
    case "html":
      parsed = parseHtmlTranscript(body);
      break;
  }
  if (!parsed.segments.length)
    throw new Error(`no text in the ${kind} transcript`);
  return parsed;
}
