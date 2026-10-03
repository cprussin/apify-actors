import type { Format } from "./input.js";

export const CONTENT_TYPES: Record<Format, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
};

export const EXTENSIONS: Record<Format, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
  pdf: "pdf",
};

/** Key-value store keys allow [a-zA-Z0-9!-_.'()], up to 256 chars. */
const MAX_SLUG = 80;

/** URL to a readable key slug, e.g. "example-com-docs-intro". */
export function urlSlug(url: string): string {
  let host = url;
  let path = "";
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^www\./, "");
    path = `${u.pathname}${u.search}`;
  } catch {
    // Keep the raw string.
  }
  const slug = `${host}${path}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/, "");
  return slug || "page";
}

/**
 * Stable, unique record key per input position, e.g.
 * "screenshot-0001-example-com.png". The index keeps keys unique and in input
 * order; the slug keeps them readable.
 */
export function recordKey(index: number, url: string, format: Format): string {
  return `screenshot-${String(index + 1).padStart(4, "0")}-${urlSlug(url)}.${EXTENSIONS[format]}`;
}

/** Pixel size of a PNG, JPEG or WebP image, or null if unknown. */
export function imageSize(
  buf: Uint8Array,
): { width: number; height: number } | null {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  // PNG: IHDR right after the 8-byte signature.
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47)
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  // JPEG: scan segments for a start-of-frame marker.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = b[i + 1]!;
      if (
        marker === 0xd8 ||
        marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
        i += 2;
        continue;
      }
      const len = b.readUInt16BE(i + 2);
      const isSof =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isSof)
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return null;
  }
  // WebP: RIFF....WEBP + VP8 / VP8L / VP8X chunk.
  if (
    b.length >= 30 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  ) {
    const chunk = b.toString("ascii", 12, 16);
    if (chunk === "VP8 ")
      return {
        width: b.readUInt16LE(26) & 0x3fff,
        height: b.readUInt16LE(28) & 0x3fff,
      };
    if (chunk === "VP8L") {
      const bits = b.readUInt32LE(21);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    if (chunk === "VP8X")
      return {
        width: b.readUIntLE(24, 3) + 1,
        height: b.readUIntLE(27, 3) + 1,
      };
  }
  return null;
}
