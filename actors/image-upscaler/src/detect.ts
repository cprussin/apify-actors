export const IMAGE_FORMATS = [
  "jpg",
  "png",
  "webp",
  "gif",
  "bmp",
  "tiff",
  "avif",
] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

export type Detection =
  { format: ImageFormat } | { format: null; error: string };

const SUPPORTED = "Use JPEG, PNG, WebP, GIF, BMP, TIFF or AVIF.";

const startsWith = (buf: Buffer, sig: number[], at = 0) =>
  buf.length >= at + sig.length && sig.every((b, i) => buf[at + i] === b);
const ascii = (buf: Buffer, at: number, s: string) =>
  buf.subarray(at, at + s.length).toString("latin1") === s;

/**
 * The image format from the file's first bytes, or a helpful error for
 * common non-image downloads (web pages, JSON, PDFs) and image formats the
 * decoder doesn't support (HEIC, SVG).
 */
export function detectImage(head: Buffer): Detection {
  if (!head.length) return { format: null, error: "The file is empty." };
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { format: "jpg" };
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { format: "png" };
  if (ascii(head, 0, "RIFF") && ascii(head, 8, "WEBP"))
    return { format: "webp" };
  if (ascii(head, 0, "GIF87a") || ascii(head, 0, "GIF89a"))
    return { format: "gif" };
  if (ascii(head, 0, "BM")) return { format: "bmp" };
  if (ascii(head, 0, "II*\0") || ascii(head, 0, "MM\0*"))
    return { format: "tiff" };
  if (ascii(head, 4, "ftyp")) {
    const brand = head.subarray(8, 12).toString("latin1");
    if (brand === "avif" || brand === "avis") return { format: "avif" };
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand))
      return {
        format: null,
        error: `HEIC/HEIF images (iPhone photos) are not supported. Convert to JPEG or PNG first. ${SUPPORTED}`,
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
    if (/<svg[\s>]/.test(text))
      return {
        format: null,
        error: `SVG is a vector format: it scales without upscaling. ${SUPPORTED}`,
      };
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
