import { describe, expect, it } from "vitest";
import { detectImage } from "../src/detect.js";
import { makePng } from "./png.js";

const ftyp = (brand: string) =>
  Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from(`ftyp${brand}`)]);

describe("detectImage", () => {
  it("recognizes image formats by their first bytes", () => {
    expect(detectImage(makePng(2, 2))).toEqual({ format: "png" });
    expect(detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toEqual({
      format: "jpg",
    });
    expect(detectImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toEqual({
      format: "webp",
    });
    expect(detectImage(Buffer.from("GIF89a"))).toEqual({ format: "gif" });
    expect(detectImage(Buffer.from("BM\0\0"))).toEqual({ format: "bmp" });
    expect(detectImage(Buffer.from("II*\0"))).toEqual({ format: "tiff" });
    expect(detectImage(Buffer.from("MM\0*"))).toEqual({ format: "tiff" });
    expect(detectImage(ftyp("avif"))).toEqual({ format: "avif" });
  });

  it("explains common non-image downloads", () => {
    const err = (b: Buffer) => {
      const d = detectImage(b);
      return d.format ? null : d.error;
    };
    expect(err(Buffer.alloc(0))).toMatch(/empty/);
    expect(err(Buffer.from("\n <!DOCTYPE html><html>"))).toMatch(/web page/);
    expect(
      err(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">')),
    ).toMatch(/SVG/);
    expect(err(ftyp("heic"))).toMatch(/HEIC/);
    expect(err(Buffer.from("%PDF-1.7"))).toMatch(/PDF/);
    expect(err(Buffer.from('{"error":"nope"}'))).toMatch(/JSON/);
    expect(err(Buffer.from("just some text"))).toMatch(/Not a supported image/);
  });
});
