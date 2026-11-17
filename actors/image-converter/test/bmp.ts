/** Builds an uncompressed BMP from RGB(A) pixels, for tests. */
export function makeBmp(
  width: number,
  height: number,
  bpp: 8 | 24 | 32,
  pixel: (x: number, y: number) => [number, number, number, number?],
  opts: { topDown?: boolean; compression?: number } = {},
): Buffer {
  const stride = Math.ceil((width * bpp) / 32) * 4;
  const paletteSize = bpp === 8 ? 256 * 4 : 0;
  const masksSize = opts.compression === 6 ? 16 : 0;
  const offset = 14 + 40 + masksSize + paletteSize;
  const buf = Buffer.alloc(offset + stride * height);
  buf.write("BM", 0, "latin1");
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(offset, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(opts.topDown ? -height : height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(bpp, 28);
  buf.writeUInt32LE(opts.compression ?? 0, 30);
  if (opts.compression === 6) {
    buf.writeUInt32LE(0x00ff0000, 54);
    buf.writeUInt32LE(0x0000ff00, 58);
    buf.writeUInt32LE(0x000000ff, 62);
    buf.writeUInt32LE(0xff000000, 66);
  }
  if (bpp === 8)
    // Grey palette: index i is (i, i, i).
    for (let i = 0; i < 256; i++)
      buf.writeUInt32LE((i << 16) | (i << 8) | i, 54 + masksSize + i * 4);
  for (let y = 0; y < height; y++) {
    const row = offset + (opts.topDown ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = pixel(x, y);
      if (bpp === 8) buf[row + x] = r;
      else if (bpp === 24) buf.set([b, g, r], row + x * 3);
      else buf.set([b, g, r, a], row + x * 4);
    }
  }
  return buf;
}
