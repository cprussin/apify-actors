/** Blank-frame and near-duplicate checks on a small grayscale thumbnail. */

/** Thumbnail size the checks read (FFmpeg scales each frame to it). */
export const THUMB_WIDTH = 64;
export const THUMB_HEIGHT = 36;

/** A frame is blank below this luma standard deviation... */
export const BLANK_STDDEV = 4;
/** ...or when its mean luma is under this (black) or over the next (white). */
export const BLANK_DARK = 8;
export const BLANK_LIGHT = 247;

export interface FrameStats {
  mean: number;
  stddev: number;
  /** 64-bit difference hash (dHash). */
  hash: bigint;
}

/** Mean and standard deviation of 8-bit gray pixels. */
export function lumaStats(gray: Uint8Array): { mean: number; stddev: number } {
  if (!gray.length) return { mean: 0, stddev: 0 };
  let sum = 0;
  for (const v of gray) sum += v;
  const mean = sum / gray.length;
  let sq = 0;
  for (const v of gray) sq += (v - mean) ** 2;
  return { mean, stddev: Math.sqrt(sq / gray.length) };
}

export const isBlank = (s: { mean: number; stddev: number }) =>
  s.stddev < BLANK_STDDEV || s.mean < BLANK_DARK || s.mean > BLANK_LIGHT;

/**
 * dHash of a `width`x`height` gray image: box-averaged to 9x8, then one
 * bit per pixel brighter than its right neighbour.
 */
export function dHash(gray: Uint8Array, width: number, height: number): bigint {
  const cols = 9;
  const rows = 8;
  const cells: number[] = [];
  for (let r = 0; r < rows; r++) {
    const y0 = Math.floor((r * height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((r + 1) * height) / rows));
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c * width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * width) / cols));
      let sum = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) sum += gray[y * width + x] ?? 0;
      cells.push(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  let hash = 0n;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols - 1; c++)
      hash =
        (hash << 1n) |
        BigInt(cells[r * cols + c]! > cells[r * cols + c + 1]! ? 1 : 0);
  return hash;
}

/** Number of differing bits. */
export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

export function frameStats(gray: Uint8Array): FrameStats {
  return { ...lumaStats(gray), hash: dHash(gray, THUMB_WIDTH, THUMB_HEIGHT) };
}
