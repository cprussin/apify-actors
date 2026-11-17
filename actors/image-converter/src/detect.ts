export const IMAGE_FORMATS = [
  "jpeg",
  "png",
  "webp",
  "avif",
  "gif",
  "tiff",
  "bmp",
  "heic",
  "svg",
] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

export type Detection =
  { format: ImageFormat } | { format: null; error: string };

const SUPPORTED = "Use JPEG, PNG, WebP, AVIF, GIF, TIFF, BMP, HEIC or SVG.";

const startsWith = (buf: Buffer, sig: number[], at = 0) =>
  buf.length >= at + sig.length && sig.every((b, i) => buf[at + i] === b);
const ascii = (buf: Buffer, at: number, s: string) =>
  buf.subarray(at, at + s.length).toString("latin1") === s;

/** ISO-BMFF brands: AVIF and HEIC share the container. */
const AVIF_BRANDS = /^(avif|avis)$/;
const HEIC_BRANDS = /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/;

/** Major brand, then the compatible brands, of an ftyp box. */
function brands(head: Buffer): string[] {
  const size = Math.min(head.readUInt32BE(0), head.length, 256);
  const out = [head.subarray(8, 12).toString("latin1")];
  for (let at = 16; at + 4 <= size; at += 4)
    out.push(head.subarray(at, at + 4).toString("latin1"));
  return out;
}

/**
 * The image format from the file's first bytes, or a helpful error for
 * common non-image downloads (web pages, JSON, PDFs).
 */
export function detectImage(head: Buffer): Detection {
  if (!head.length) return { format: null, error: "The file is empty." };
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { format: "jpeg" };
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { format: "png" };
  if (ascii(head, 0, "RIFF") && ascii(head, 8, "WEBP"))
    return { format: "webp" };
  if (ascii(head, 0, "GIF87a") || ascii(head, 0, "GIF89a"))
    return { format: "gif" };
  if (ascii(head, 0, "BM") && head.length >= 26) return { format: "bmp" };
  if (ascii(head, 0, "II*\0") || ascii(head, 0, "MM\0*"))
    return { format: "tiff" };
  if (head.length >= 16 && ascii(head, 4, "ftyp")) {
    const b = brands(head);
    // The major brand decides; "mif1" files list avif or heic as compatible.
    if (AVIF_BRANDS.test(b[0]!)) return { format: "avif" };
    if (HEIC_BRANDS.test(b[0]!))
      return {
        format:
          b.slice(1).some((x) => AVIF_BRANDS.test(x)) &&
          !b.slice(1).some((x) => /^(heic|heix)$/.test(x))
            ? "avif"
            : "heic",
      };
  }
  const text = head
    .subarray(0, 2048)
    .toString("latin1")
    .replace(/^\xEF\xBB\xBF/, "")
    .trimStart()
    .toLowerCase();
  if (text.startsWith("%pdf"))
    return {
      format: null,
      error:
        "This is a PDF document, not an image. For documents, use the document-to-markdown actor.",
    };
  if (text.startsWith("<")) {
    if (/<svg[\s>]/.test(text)) return { format: "svg" };
    if (/<html[\s>]|<!doctype html|<head[\s>]|<body[\s>]/.test(text))
      return {
        format: null,
        error:
          "This link is a web page, not an image. Use the direct image link (e.g. ending in .jpg or .png; right-click the image and copy its address).",
      };
  }
  if (text.startsWith("{") || text.startsWith("["))
    return { format: null, error: "This link returns JSON, not an image." };
  return { format: null, error: `Not a supported image. ${SUPPORTED}` };
}
