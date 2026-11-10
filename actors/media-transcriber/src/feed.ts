import * as cheerio from "cheerio";
import { transcriptKind, type PublishedTranscript } from "./transcript.js";

/** One podcast episode with an audio or video enclosure. */
export interface Episode {
  /** The item's guid, or its enclosure URL when it has none. */
  guid: string;
  title: string | null;
  /** Enclosure (media file) URL. */
  url: string;
  /** ISO 8601, or null when the feed has no (valid) date. */
  publishedAt: string | null;
  /** From itunes:duration, when present. */
  durationSecs: number | null;
  /** Podcasting 2.0 <podcast:transcript> links, best (timed) first. */
  transcripts: PublishedTranscript[];
}

export interface Feed {
  title: string | null;
  /** Primary language subtag of the channel's <language>, e.g. "en". */
  language: string | null;
  episodes: Episode[];
}

/** "en-US" -> "en". */
export const langCode = (raw: string | null | undefined): string | null => {
  const m = /^\s*([a-z]{2,3})(?:[-_]|\s*$)/i.exec(raw ?? "");
  return m ? m[1]!.toLowerCase() : null;
};

/** itunes:duration: "HH:MM:SS", "MM:SS" or seconds. */
export function parseDuration(raw: string | null | undefined): number | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.\d+)?$/.exec(s);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

const isoDate = (raw: string | undefined): string | null => {
  const t = Date.parse((raw ?? "").trim());
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

const isMediaType = (type: string | undefined) =>
  !type || /^(audio|video)\//i.test(type) || /octet-stream/i.test(type);

/** Timed formats first; plain text and HTML only as a last resort. */
const KIND_ORDER = { vtt: 0, srt: 1, json: 2, text: 3, html: 4 } as const;

const clean = (s: string | undefined) => s?.replace(/\s+/g, " ").trim() || null;

/** Parses an RSS 2.0 or Atom podcast feed, newest episodes first. */
export function parseFeed(xml: string, baseUrl?: string): Feed {
  const head = xml.slice(0, 2000).toLowerCase();
  if (!/<rss[\s>]|<feed[\s>]|<rdf:rdf[\s>]/.test(head))
    throw new Error(
      head.includes("<html")
        ? "This link is a web page, not an RSS feed. Use the podcast's RSS feed URL (e.g. from its Apple Podcasts or hosting page)."
        : "Not an RSS or Atom feed.",
    );
  const $ = cheerio.load(xml, { xml: true });
  const abs = (u: string | undefined) => {
    if (!u?.trim()) return null;
    try {
      const url = new URL(u.trim(), baseUrl);
      return url.protocol === "http:" || url.protocol === "https:"
        ? url.href
        : null;
    } catch {
      return null;
    }
  };
  const episodes: Episode[] = [];
  const items = $("item, entry");
  items.each((_, el) => {
    const item = $(el);
    // RSS <enclosure url type>, or Atom <link rel="enclosure" href type>.
    const candidates = [
      ...item
        .children("enclosure")
        .toArray()
        .map((e) => ({ url: $(e).attr("url"), type: $(e).attr("type") })),
      ...item
        .children('link[rel="enclosure"]')
        .toArray()
        .map((e) => ({ url: $(e).attr("href"), type: $(e).attr("type") })),
    ].filter((c) => isMediaType(c.type) && abs(c.url));
    // Prefer audio (smaller) over video.
    const enc =
      candidates.find((c) => /^audio\//i.test(c.type ?? "")) ?? candidates[0];
    if (!enc) return;
    const url = abs(enc.url)!;
    const guid = clean(item.children("guid, id").first().text()) ?? url;
    const transcripts: PublishedTranscript[] = [];
    for (const t of item.children("podcast\\:transcript").toArray()) {
      const kind = transcriptKind($(t).attr("type"));
      const tUrl = abs($(t).attr("url"));
      if (kind && tUrl && !transcripts.some((x) => x.url === tUrl))
        transcripts.push({
          url: tUrl,
          kind,
          language: langCode($(t).attr("language")),
        });
    }
    transcripts.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
    episodes.push({
      guid,
      title: clean(item.children("title").first().text()),
      url,
      publishedAt: isoDate(
        item.children("pubDate, published, updated").first().text() ||
          item.children("dc\\:date").first().text(),
      ),
      durationSecs: parseDuration(
        item.children("itunes\\:duration").first().text(),
      ),
      transcripts,
    });
  });
  // Newest first; undated episodes keep feed order, after dated ones.
  const order = episodes.map((e, i) => ({ e, i }));
  order.sort((a, b) => {
    const da = a.e.publishedAt;
    const db = b.e.publishedAt;
    if (da && db && da !== db) return da < db ? 1 : -1;
    if (da && !db) return -1;
    if (!da && db) return 1;
    return a.i - b.i;
  });
  return {
    title: clean(
      $("channel > title").first().text() || $("feed > title").first().text(),
    ),
    language: langCode(
      $("channel > language").first().text() ||
        $("feed").first().attr("xml:lang"),
    ),
    episodes: order.map((o) => o.e),
  };
}
