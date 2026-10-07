/**
 * Catches common non-media downloads (web pages, feeds, PDFs) by their first
 * bytes, with a helpful message. Everything else goes to FFmpeg, which
 * decides whether it is audio or video. Returns null when it may be media.
 */
export function notMediaError(
  head: Buffer,
  contentType: string | null,
): string | null {
  if (!head.length) return "The file is empty.";
  const text = head
    .subarray(0, 2048)
    .toString("latin1")
    .replace(/^\xEF\xBB\xBF/, "") // UTF-8 BOM, read as latin1
    .trimStart()
    .toLowerCase();
  if (text.startsWith("%pdf"))
    return "This is a PDF document, not an audio or video file. For documents, use the document-to-markdown actor.";
  if (text.startsWith("<")) {
    if (/<rss[\s>]|<feed[\s>]|<channel[\s>]/.test(text))
      return "This is an RSS or Atom feed, not a media file. Put feed links in Podcast RSS feeds (rssFeeds).";
    if (/<html[\s>]|<!doctype html|<head[\s>]|<body[\s>]/.test(text))
      return "This link is a web page, not an audio or video file. Use the direct file link (e.g. ending in .mp3, .m4a or .mp4).";
  }
  const ct = (contentType ?? "").toLowerCase();
  if ((text.startsWith("{") || text.startsWith("[")) && ct.includes("json"))
    return "This link returns JSON, not an audio or video file.";
  return null;
}
