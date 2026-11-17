/**
 * A small BMP decoder: sharp's prebuilt libvips has no BMP loader. Covers
 * uncompressed 1/4/8-bit (palette), 16-bit (5-5-5), 24-bit and 32-bit
 * files, and BI_BITFIELDS masks for 16/32-bit. RLE-compressed and
 * embedded JPEG/PNG BMPs are refused.
 */
export interface RawImage {
  data: Buffer;
  width: number;
  height: number;
  channels: 3 | 4;
}

export class BmpError extends Error {
  override name = "BmpError";
}

/** Width and height from the header, without decoding. */
export function bmpSize(buf: Buffer): { width: number; height: number } {
  if (buf.length < 26 || buf.toString("latin1", 0, 2) !== "BM")
    throw new BmpError("Not a BMP file.");
  const headerSize = buf.readUInt32LE(14);
  if (headerSize === 12)
    return { width: buf.readUInt16LE(18), height: buf.readUInt16LE(20) };
  if (buf.length < 54) throw new BmpError("The BMP header is truncated.");
  return {
    width: Math.abs(buf.readInt32LE(18)),
    height: Math.abs(buf.readInt32LE(22)),
  };
}

const maskShift = (mask: number) => {
  if (!mask) return { shift: 0, max: 1 };
  let shift = 0;
  while (!((mask >>> shift) & 1)) shift++;
  return { shift, max: mask >>> shift };
};

export function decodeBmp(buf: Buffer, maxPixels: number): RawImage {
  const { width, height } = bmpSize(buf);
  const dataOffset = buf.readUInt32LE(10);
  const headerSize = buf.readUInt32LE(14);
  if (headerSize === 12)
    throw new BmpError("OS/2 BMP files are not supported.");
  const topDown = buf.readInt32LE(22) < 0;
  const bpp = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);
  if (!width || !height) throw new BmpError("The BMP has no pixels.");
  if (width * height > maxPixels)
    throw new BmpError(
      `The image is ${width}x${height}, over the input limit (maxInputMegapixels).`,
    );

  // 0 = BI_RGB, 3 = BI_BITFIELDS, 6 = BI_ALPHABITFIELDS.
  let masks: [number, number, number, number] | null = null;
  if (compression === 3 || compression === 6) {
    if (bpp !== 16 && bpp !== 32)
      throw new BmpError("Unsupported BMP bitfields.");
    // Masks follow a 40-byte header, or sit inside a V4/V5 header.
    const at = 14 + 40;
    masks = [
      buf.readUInt32LE(at),
      buf.readUInt32LE(at + 4),
      buf.readUInt32LE(at + 8),
      compression === 6 || headerSize >= 56 ? buf.readUInt32LE(at + 12) : 0,
    ];
  } else if (compression !== 0) {
    throw new BmpError(
      "Compressed BMP files (RLE, embedded JPEG or PNG) are not supported. Save it as an uncompressed BMP, PNG or JPEG.",
    );
  } else if (bpp === 16) {
    masks = [0x7c00, 0x03e0, 0x001f, 0];
  } else if (bpp === 32) {
    masks = [0x00ff0000, 0x0000ff00, 0x000000ff, 0];
  }
  if (![1, 4, 8, 16, 24, 32].includes(bpp))
    throw new BmpError(`${bpp}-bit BMP files are not supported.`);

  let palette: Buffer | null = null;
  if (bpp <= 8) {
    const colors = buf.readUInt32LE(46) || 1 << bpp;
    const at = 14 + headerSize;
    palette = buf.subarray(at, at + colors * 4);
  }

  const stride = Math.ceil((width * bpp) / 32) * 4;
  if (dataOffset + stride * height > buf.length)
    throw new BmpError("The BMP file is truncated.");

  // A 32-bit file has alpha only if its alpha mask is set and any pixel
  // uses it (many writers leave the byte at 0).
  const alphaMask = masks?.[3] ?? 0;
  const channels: 3 | 4 = alphaMask ? 4 : 3;
  const out = Buffer.alloc(width * height * channels);
  const m = masks?.map(maskShift);
  let anyAlpha = false;

  for (let y = 0; y < height; y++) {
    const row = dataOffset + (topDown ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * channels;
      let r: number, g: number, b: number;
      let a = 255;
      if (palette) {
        const bit = x * bpp;
        const byte = buf[row + (bit >> 3)]!;
        const idx =
          bpp === 8 ? byte : (byte >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        b = palette[idx * 4] ?? 0;
        g = palette[idx * 4 + 1] ?? 0;
        r = palette[idx * 4 + 2] ?? 0;
      } else if (bpp === 24) {
        b = buf[row + x * 3]!;
        g = buf[row + x * 3 + 1]!;
        r = buf[row + x * 3 + 2]!;
      } else {
        const px =
          bpp === 16
            ? buf.readUInt16LE(row + x * 2)
            : buf.readUInt32LE(row + x * 4);
        const ch = (i: number) => {
          const { shift, max } = m![i]!;
          return Math.round((((px & masks![i]!) >>> shift) * 255) / max);
        };
        r = ch(0);
        g = ch(1);
        b = ch(2);
        if (alphaMask) {
          a = ch(3);
          if (a) anyAlpha = true;
        }
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      if (channels === 4) out[o + 3] = a;
    }
  }
  // All-zero alpha means the writer didn't use it: treat as opaque.
  if (channels === 4 && !anyAlpha)
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return { data: out, width, height, channels };
}
