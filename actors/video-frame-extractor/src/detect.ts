const startsWith = (buf: Buffer, sig: number[]) =>
  buf.length >= sig.length && sig.every((b, i) => buf[i] === b);

/**
 * Catches common non-video downloads (web pages, streaming playlists,
 * images, PDFs) by their first bytes, with a helpful message. Everything
 * else goes to FFprobe, which decides whether it is a video. Returns null
 * when it may be a video.
 */
export function notVideoError(
  head: Buffer,
  contentType: string | null,
): string | null {
  if (!head.length) return "The file is empty.";
  if (
    startsWith(head, [0xff, 0xd8, 0xff]) ||
    startsWith(head, [0x89, 0x50, 0x4e, 0x47]) ||
    (head.subarray(0, 4).toString("latin1") === "RIFF" &&
      head.subarray(8, 12).toString("latin1") === "WEBP")
  )
    return "This is an image, not a video. Use a direct link to a video file (e.g. ending in .mp4, .mov or .webm).";
  const text = head
    .subarray(0, 2048)
    .toString("latin1")
    .replace(/^\xEF\xBB\xBF/, "") // UTF-8 BOM, read as latin1
    .trimStart()
    .toLowerCase();
  if (text.startsWith("%pdf"))
    return "This is a PDF document, not a video. For documents, use the document-to-markdown actor.";
  if (text.startsWith("#extm3u"))
    return "This is an HLS streaming playlist (.m3u8), not a video file. Streams are not supported: use a direct link to a complete video file (e.g. .mp4).";
  if (text.startsWith("<")) {
    if (/<mpd[\s>]/.test(text))
      return "This is a DASH streaming manifest (.mpd), not a video file. Streams are not supported: use a direct link to a complete video file (e.g. .mp4).";
    if (/<html[\s>]|<!doctype html|<head[\s>]|<body[\s>]/.test(text))
      return "This link is a web page, not a video file. Use the direct file link (e.g. ending in .mp4, .mov or .webm).";
  }
  const ct = (contentType ?? "").toLowerCase();
  if ((text.startsWith("{") || text.startsWith("[")) && ct.includes("json"))
    return "This link returns JSON, not a video file.";
  return null;
}
