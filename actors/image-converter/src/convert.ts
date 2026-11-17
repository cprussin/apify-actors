import sharp, { type Sharp, type SharpOptions } from "sharp";
import type { RawImage } from "./bmp.js";
import type { Fit, OutputFormat } from "./input.js";

/** What sharp can read: a file path, an SVG/other buffer, or raw pixels. */
export type Decodable =
  | { kind: "file"; path: string }
  | { kind: "buffer"; data: Buffer }
  | { kind: "raw"; image: RawImage };

export interface ProbeInfo {
  /** Width and height after EXIF rotation. */
  width: number;
  height: number;
  pages: number;
  hasAlpha: boolean;
}

export interface ConvertOptions {
  format: OutputFormat;
  quality: number;
  targetBytes: number | null;
  maxWidth: number | null;
  maxHeight: number | null;
  fit: Fit;
  stripMetadata: boolean;
  maxInputPixels: number;
  timeoutSecs: number;
}

export interface ConvertResult {
  data: Buffer;
  width: number;
  height: number;
  /** The quality used (null for lossless PNG). */
  quality: number | null;
  warnings: string[];
}

export const CONTENT_TYPES: Record<OutputFormat, string> = {
  webp: "image/webp",
  avif: "image/avif",
  jpeg: "image/jpeg",
  png: "image/png",
};

/** File extension per output format. */
export const EXTENSIONS: Record<OutputFormat, string> = {
  webp: "webp",
  avif: "avif",
  jpeg: "jpg",
  png: "png",
};

const open = (src: Decodable, maxPixels: number): Sharp => {
  // A little headroom: the caller checks the exact limit with a clear error.
  const opts: SharpOptions = {
    limitInputPixels: Math.ceil(maxPixels * 1.01),
    failOn: "error",
  };
  if (src.kind === "file") return sharp(src.path, opts);
  if (src.kind === "buffer") return sharp(src.data, opts);
  const { data, width, height, channels } = src.image;
  return sharp(data, { ...opts, raw: { width, height, channels } });
};

/** Size and frame count from the image header (no full decode). */
export async function probe(src: Decodable): Promise<ProbeInfo> {
  if (src.kind === "raw")
    return {
      width: src.image.width,
      height: src.image.height,
      pages: 1,
      hasAlpha: src.image.channels === 4,
    };
  // No pixel limit here: the header alone is read, and the caller reports
  // an over-size image with its dimensions.
  const m = await sharp(src.kind === "file" ? src.path : src.data, {
    limitInputPixels: false,
  }).metadata();
  if (!m.width || !m.height) throw new Error("The image has no dimensions.");
  return {
    width: m.autoOrient?.width ?? m.width,
    height: m.autoOrient?.height ?? m.height,
    pages: m.pages ?? 1,
    hasAlpha: !!m.hasAlpha,
  };
}

function pipeline(
  src: Decodable,
  opts: ConvertOptions,
  quality: number,
  palette: boolean,
): Sharp {
  let img = open(src, opts.maxInputPixels).rotate();
  if (opts.maxWidth || opts.maxHeight)
    img = img.resize({
      width: opts.maxWidth ?? undefined,
      height: opts.maxHeight ?? undefined,
      fit: opts.fit,
      withoutEnlargement: true,
      // contain pads with transparent (or white, for JPEG) borders.
      background:
        opts.format === "jpeg"
          ? { r: 255, g: 255, b: 255, alpha: 1 }
          : { r: 0, g: 0, b: 0, alpha: 0 },
    });
  if (!opts.stripMetadata) img = img.keepMetadata();
  switch (opts.format) {
    case "jpeg":
      img = img
        .flatten({ background: "#ffffff" })
        .jpeg({ quality, mozjpeg: true });
      break;
    case "webp":
      img = img.webp({ quality, effort: 4 });
      break;
    case "avif":
      img = img.avif({ quality, effort: 1 });
      break;
    case "png":
      img = palette
        ? img.png({
            palette: true,
            quality,
            effort: 1,
            dither: 0,
            compressionLevel: 6,
          })
        : img.png({ compressionLevel: 6, adaptiveFiltering: true });
      break;
  }
  return img.timeout({ seconds: opts.timeoutSecs });
}

async function encode(
  src: Decodable,
  opts: ConvertOptions,
  quality: number,
  palette = false,
) {
  const { data, info } = await pipeline(src, opts, quality, palette).toBuffer({
    resolveWithObject: true,
  });
  return { data, width: info.width, height: info.height };
}

/** Bisection steps for targetKb after the first try (quality to within ~3). */
export const TARGET_STEPS = 5;

/**
 * Converts one image. With a target size, searches the highest quality
 * whose output fits (PNG: lossless first, then palette quantization).
 */
export async function convert(
  src: Decodable,
  info: ProbeInfo,
  opts: ConvertOptions,
): Promise<ConvertResult> {
  const warnings: string[] = [];
  if (info.pages > 1)
    warnings.push(
      `Animated or multi-page image: only the first of ${info.pages} frames was converted.`,
    );
  if (opts.format === "jpeg" && info.hasAlpha)
    warnings.push("JPEG has no transparency: flattened onto white.");

  const target = opts.targetBytes;
  if (target === null) {
    const lossless = opts.format === "png";
    const out = await encode(src, opts, opts.quality);
    return { ...out, quality: lossless ? null : opts.quality, warnings };
  }

  // Bisect for the highest quality in [1, opts.quality] that fits. PNG
  // tries lossless first, then a 256-colour palette at falling quality.
  type Encoded = Awaited<ReturnType<typeof encode>> & { q: number | null };
  const tried: Encoded[] = [];
  const palette = opts.format === "png";
  if (palette) {
    const lossless = { ...(await encode(src, opts, 100)), q: null };
    if (lossless.data.length <= target)
      return { ...lossless, quality: null, warnings };
    tried.push(lossless);
  }
  const at = async (q: number) => {
    let out = tried.find((t) => t.q === q);
    if (!out)
      tried.push((out = { ...(await encode(src, opts, q, palette)), q }));
    return out;
  };
  let best: Encoded | null = null;
  let lo = 1;
  let hi = opts.quality;
  for (let q = hi, step = 0; lo <= hi && step <= TARGET_STEPS; step++) {
    const out = await at(q);
    if (out.data.length <= target) {
      best = out;
      lo = q + 1;
    } else hi = q - 1;
    q = Math.floor((lo + hi) / 2);
  }
  if (!best && (await at(1)).data.length <= target) best = await at(1);
  if (!best) {
    best = tried.reduce((a, b) => (b.data.length < a.data.length ? b : a));
    warnings.push(
      `Could not reach ${Math.round(target / 1024)} KB even at quality 1; returned the smallest file (${Math.ceil(best.data.length / 1024)} KB). Set maxWidth/maxHeight to shrink it further.`,
    );
  }
  const { q, ...out } = best;
  return { ...out, quality: q, warnings };
}

/**
 * A 640x480 test image: colour gradients with a soft circle, so the
 * formats compress it realistically (no flat colour, no noise).
 */
export async function sampleImage(width: number, height: number) {
  const px = Buffer.alloc(width * height * 3);
  const cx = width / 2;
  const cy = height / 2;
  const r2 = (Math.min(width, height) / 3) ** 2;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      const d = ((x - cx) ** 2 + (y - cy) ** 2) / r2;
      const inCircle = d < 1;
      px[o] = Math.round((x / (width - 1)) * 255);
      px[o + 1] = inCircle
        ? Math.round(255 * (1 - d))
        : Math.round((y / (height - 1)) * 200);
      px[o + 2] = Math.round(128 + 127 * Math.sin((x + y) / 23));
    }
  return sharp(px, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}
