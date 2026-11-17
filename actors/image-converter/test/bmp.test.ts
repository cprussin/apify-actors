import { describe, expect, it } from "vitest";
import { BmpError, bmpSize, decodeBmp } from "../src/bmp.js";
import { makeBmp } from "./bmp.js";

const px = (x: number, y: number): [number, number, number, number] => [
  x * 10,
  y * 20,
  (x + y) * 5,
  x === 0 ? 0 : 255,
];

describe("decodeBmp", () => {
  it("decodes bottom-up 24-bit files", () => {
    const img = decodeBmp(makeBmp(5, 3, 24, px), 1e6);
    expect(img).toMatchObject({ width: 5, height: 3, channels: 3 });
    // Pixel (4, 2): rows are stored bottom-up and padded to 4 bytes.
    const o = (2 * 5 + 4) * 3;
    expect([...img.data.subarray(o, o + 3)]).toEqual([40, 40, 30]);
  });

  it("decodes top-down 32-bit files with an alpha mask", () => {
    const img = decodeBmp(
      makeBmp(3, 2, 32, px, { topDown: true, compression: 6 }),
      1e6,
    );
    expect(img.channels).toBe(4);
    expect([...img.data.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    const o = (1 * 3 + 2) * 4;
    expect([...img.data.subarray(o, o + 4)]).toEqual([20, 20, 15, 255]);
  });

  it("treats plain 32-bit files as opaque RGB", () => {
    const img = decodeBmp(makeBmp(2, 2, 32, px), 1e6);
    expect(img.channels).toBe(3);
  });

  it("decodes 8-bit palette files", () => {
    const img = decodeBmp(
      makeBmp(4, 1, 8, (x) => [x * 50, 0, 0]),
      1e6,
    );
    expect([...img.data.subarray(9, 12)]).toEqual([150, 150, 150]);
  });

  it("refuses RLE files and images over the pixel limit", () => {
    expect(() =>
      decodeBmp(makeBmp(2, 2, 8, px, { compression: 1 }), 1e6),
    ).toThrow(/Compressed BMP/);
    expect(() => decodeBmp(makeBmp(20, 20, 24, px), 100)).toThrow(BmpError);
    expect(bmpSize(makeBmp(20, 10, 24, px))).toEqual({ width: 20, height: 10 });
  });
});
