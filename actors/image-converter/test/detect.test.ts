import { describe, expect, it } from "vitest";
import { detectImage } from "../src/detect.js";
import { makePng } from "./png.js";

const ftyp = (major: string, ...compatible: string[]) => {
  const size = 16 + 4 * compatible.length;
  const b = Buffer.alloc(size + 8);
  b.writeUInt32BE(size, 0);
  b.write("ftyp", 4, "latin1");
  b.write(major, 8, "latin1");
  compatible.forEach((c, i) => b.write(c, 16 + 4 * i, "latin1"));
  return b;
};

describe("detectImage", () => {
  it("recognizes image signatures", () => {
    const f = (b: Buffer | string) =>
      detectImage(Buffer.isBuffer(b) ? b : Buffer.from(b, "latin1")).format;
    expect(f(makePng(2, 2))).toBe("png");
    expect(f(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("jpeg");
    expect(f("RIFF\0\0\0\0WEBPVP8 ")).toBe("webp");
    expect(f("GIF89a\x01\0\x01\0")).toBe("gif");
    expect(f("II*\0\x08\0\0\0")).toBe("tiff");
    expect(f(`BM${"\0".repeat(30)}`)).toBe("bmp");
    expect(f(ftyp("avif", "mif1", "miaf"))).toBe("avif");
    expect(f(ftyp("heic", "mif1", "heic"))).toBe("heic");
    expect(f(ftyp("mif1", "avif", "miaf"))).toBe("avif");
    expect(f(ftyp("mif1", "heic"))).toBe("heic");
    expect(f('<?xml version="1.0"?>\n<svg xmlns="x" width="1">')).toBe("svg");
  });

  it("explains common non-image downloads", () => {
    const err = (s: string) => {
      const d = detectImage(Buffer.from(s, "latin1"));
      return d.format === null ? d.error : null;
    };
    expect(err("")).toMatch(/empty/);
    expect(err("<!DOCTYPE html><html>")).toMatch(/web page/);
    expect(err("%PDF-1.7")).toMatch(/PDF/);
    expect(err('{"a":1}')).toMatch(/JSON/);
    expect(err("hello")).toMatch(/Not a supported image/);
  });
});
