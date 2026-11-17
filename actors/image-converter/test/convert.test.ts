import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  convert,
  probe,
  sampleImage,
  type ConvertOptions,
  type Decodable,
} from "../src/convert.js";
import { detectImage } from "../src/detect.js";
import { makePng } from "./png.js";

const opts = (o: Partial<ConvertOptions> = {}): ConvertOptions => ({
  format: "webp",
  quality: 80,
  targetBytes: null,
  maxWidth: null,
  maxHeight: null,
  fit: "inside",
  stripMetadata: true,
  maxInputPixels: 50e6,
  timeoutSecs: 60,
  ...o,
});

const buf = (data: Buffer): Decodable => ({ kind: "buffer", data });

async function run(data: Buffer, o: Partial<ConvertOptions> = {}) {
  const src = buf(data);
  return convert(src, await probe(src), opts(o));
}

describe("convert", () => {
  it("converts a PNG to every output format", async () => {
    const png = makePng(64, 48);
    for (const [format, magic] of [
      ["webp", "webp"],
      ["avif", "avif"],
      ["jpeg", "jpeg"],
      ["png", "png"],
    ] as const) {
      const res = await run(png, { format });
      expect(detectImage(res.data).format, format).toBe(magic);
      expect(res).toMatchObject({ width: 64, height: 48 });
      expect(res.quality).toBe(format === "png" ? null : 80);
    }
  });

  it("resizes within the box and never enlarges", async () => {
    const png = makePng(400, 200);
    expect(await run(png, { maxWidth: 100 })).toMatchObject({
      width: 100,
      height: 50,
    });
    expect(
      await run(png, { maxWidth: 100, maxHeight: 100, fit: "cover" }),
    ).toMatchObject({ width: 100, height: 100 });
    expect(await run(png, { maxWidth: 1000 })).toMatchObject({
      width: 400,
      height: 200,
    });
  });

  it("flattens transparency for JPEG with a warning", async () => {
    const res = await run(makePng(20, 20, true), { format: "jpeg" });
    expect(res.warnings.join(" ")).toMatch(/flattened onto white/);
    const { data } = await sharp(res.data).raw().toBuffer({
      resolveWithObject: true,
    });
    // The transparent left half is now white.
    expect(data[0]).toBeGreaterThan(240);
  });

  it("applies EXIF rotation and strips metadata by default", async () => {
    const rotated = await sharp(makePng(40, 20))
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const src = buf(rotated);
    const info = await probe(src);
    expect(info).toMatchObject({ width: 20, height: 40 });
    const res = await convert(src, info, opts({ format: "jpeg" }));
    expect(res).toMatchObject({ width: 20, height: 40 });
    const meta = await sharp(res.data).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();

    const kept = await convert(
      src,
      info,
      opts({ format: "jpeg", stripMetadata: false }),
    );
    expect((await sharp(kept.data).metadata()).exif).toBeDefined();
  });

  it("finds the highest quality that fits targetKb", async () => {
    const sample = await sampleImage(640, 480);
    const free = await run(sample, { format: "jpeg", quality: 90 });
    const target = Math.round(free.data.length / 2);
    const res = await run(sample, {
      format: "jpeg",
      quality: 90,
      targetBytes: target,
    });
    expect(res.data.length).toBeLessThanOrEqual(target);
    expect(res.quality).toBeLessThan(90);
    expect(res.warnings).toEqual([]);
  });

  it("returns the smallest file with a warning when the target is unreachable", async () => {
    const res = await run(await sampleImage(640, 480), {
      format: "webp",
      targetBytes: 100,
    });
    expect(res.quality).toBe(1);
    expect(res.warnings.join(" ")).toMatch(/Could not reach 0 KB/);
  });

  it("keeps PNG lossless under the target, else quantizes it", async () => {
    const sample = await sampleImage(320, 240);
    const lossless = await run(sample, { format: "png" });
    expect(
      (await run(sample, { format: "png", targetBytes: 10_000_000 })).quality,
    ).toBeNull();
    const small = await run(sample, {
      format: "png",
      targetBytes: Math.round(lossless.data.length / 2),
    });
    expect(small.quality).not.toBeNull();
    expect(small.data.length).toBeLessThan(lossless.data.length);
  });

  it("rasterizes SVG and reads only the first frame of animations", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="10"><rect width="30" height="10" fill="red"/></svg>',
    );
    expect(await run(svg, { format: "png" })).toMatchObject({
      width: 30,
      height: 10,
    });
    const gif = await sharp(makePng(8, 8)).gif().toBuffer();
    const res = await convert(
      buf(gif),
      { width: 8, height: 8, pages: 3, hasAlpha: false },
      opts(),
    );
    expect(res).toMatchObject({ width: 8, height: 8 });
    expect(res.warnings.join(" ")).toMatch(/first of 3 frames/);
  });

  it("enforces the pixel limit while decoding", async () => {
    await expect(
      run(makePng(100, 100), { maxInputPixels: 1000 }),
    ).rejects.toThrow(/pixel limit/i);
  });
});
