/**
 * End-to-end upscaling through the real Python worker (Pillow + ONNX
 * Runtime + Real-ESRGAN) on tiny images generated at test time. Skipped when
 * the Python side isn't installed; set UPSCALER_PYTHON to a venv with
 * requirements.txt and UPSCALER_MODEL to the ONNX model (built by
 * python/export_model.py) to run it.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { copyFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectImage } from "../src/detect.js";
import { normalizeInput } from "../src/input.js";
import { runUpscales, type OutputItem } from "../src/run.js";
import { PythonWorker, type UpscaleRequest } from "../src/worker.js";

const python = process.env.UPSCALER_PYTHON ?? "python3";
const model =
  process.env.UPSCALER_MODEL ?? "/opt/models/realesr-general-x4v3.onnx";
const hasWorker =
  existsSync(model) &&
  spawnSync(python, ["-c", "import onnxruntime, numpy, PIL"], {
    stdio: "ignore",
  }).status === 0;

/** [width, height, mode] of an image, read with Pillow. */
function info(path: string): [number, number, string] {
  return JSON.parse(
    execFileSync(python, [
      "-c",
      "import json, sys; from PIL import Image; im = Image.open(sys.argv[1]); print(json.dumps([*im.size, im.mode]))",
      path,
    ]).toString(),
  );
}

describe.skipIf(!hasWorker)("Python upscaler", () => {
  let dir: string;
  let worker: PythonWorker;
  const req = (
    name: string,
    extra: Partial<UpscaleRequest> = {},
  ): UpscaleRequest => ({
    path: join(dir, name),
    outPath: join(dir, `out-${name}.${extra.format ?? "png"}`),
    scale: 4,
    format: "png",
    quality: 90,
    threads: 2,
    maxPixels: 2_000_000,
    ...extra,
  });

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "upscaler-fixtures-"));
    execFileSync(python, [
      join(import.meta.dirname, "fixtures/make_fixtures.py"),
      dir,
    ]);
    worker = new PythonWorker(python);
  }, 60_000);

  afterAll(() => {
    worker?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("probes size after EXIF rotation", async () => {
    expect(await worker.probe(join(dir, "rotated.jpg"))).toMatchObject({
      ok: true,
      format: "jpeg",
      width: 20,
      height: 40,
    });
    expect(await worker.probe(join(dir, "animated.gif"))).toMatchObject({
      ok: true,
      frames: 2,
    });
    expect(await worker.probe(join(dir, "not-image.png"))).toMatchObject({
      ok: false,
      code: "decode",
    });
  });

  it("upscales 4x to PNG with a faithful result", async () => {
    const r = await worker.upscale(req("rgb.png"), 60_000);
    if (!r.ok) throw new Error(r.error);
    expect(r).toMatchObject({
      inputWidth: 40,
      inputHeight: 30,
      outputWidth: 160,
      outputHeight: 120,
      hasAlpha: false,
      warnings: [],
    });
    expect(r.outputBytes).toBe((await stat(req("rgb.png").outPath)).size);
    expect(info(req("rgb.png").outPath)).toEqual([160, 120, "RGB"]);
    // The output looks like the input: compare against a plain resize.
    const diff = execFileSync(python, [
      "-c",
      "import sys, numpy as np; from PIL import Image; a = np.asarray(Image.open(sys.argv[1]).convert('RGB').resize((160, 120), Image.BICUBIC), float); b = np.asarray(Image.open(sys.argv[2]), float); print(np.abs(a - b).mean())",
      join(dir, "rgb.png"),
      req("rgb.png").outPath,
    ]).toString();
    expect(Number(diff)).toBeLessThan(20);
  }, 60_000);

  it("keeps transparency, grayscale and EXIF orientation", async () => {
    const a = await worker.upscale(req("alpha.png", { scale: 2 }), 60_000);
    if (!a.ok) throw new Error(a.error);
    expect(a.hasAlpha).toBe(true);
    expect(info(req("alpha.png").outPath)).toEqual([64, 64, "RGBA"]);

    const g = await worker.upscale(req("gray.png", { scale: 3 }), 60_000);
    if (!g.ok) throw new Error(g.error);
    expect(info(req("gray.png").outPath)).toEqual([72, 72, "L"]);

    const r = await worker.upscale(
      req("rotated.jpg", { format: "jpg" }),
      60_000,
    );
    if (!r.ok) throw new Error(r.error);
    expect([r.outputWidth, r.outputHeight]).toEqual([80, 160]);
    const out = readFileSync(req("rotated.jpg", { format: "jpg" }).outPath);
    expect(detectImage(out)).toEqual({ format: "jpg" });
  }, 60_000);

  it("writes JPEG and WebP, flattening alpha for JPEG", async () => {
    const j = await worker.upscale(
      req("alpha.png", { format: "jpg", quality: 80 }),
      60_000,
    );
    if (!j.ok) throw new Error(j.error);
    expect(j.warnings.join(" ")).toMatch(/flattened onto white/);
    expect(info(req("alpha.png", { format: "jpg" }).outPath)).toEqual([
      128,
      128,
      "RGB",
    ]);

    const w = await worker.upscale(
      req("photo.webp", { format: "webp", scale: 2 }),
      60_000,
    );
    if (!w.ok) throw new Error(w.error);
    const out = readFileSync(req("photo.webp", { format: "webp" }).outPath);
    expect(detectImage(out)).toEqual({ format: "webp" });
    expect([w.outputWidth, w.outputHeight]).toEqual([32, 24]);
  }, 60_000);

  it("converts CMYK and gray+alpha images", async () => {
    const c = await worker.upscale(req("cmyk.jpg", { scale: 2 }), 60_000);
    if (!c.ok) throw new Error(c.error);
    expect(info(req("cmyk.jpg").outPath)).toEqual([40, 40, "RGB"]);

    const g = await worker.upscale(
      req("gray-alpha.png", { scale: 2, format: "webp" }),
      60_000,
    );
    if (!g.ok) throw new Error(g.error);
    const j = await worker.upscale(
      req("gray-alpha.png", { scale: 2, format: "jpg" }),
      60_000,
    );
    if (!j.ok) throw new Error(j.error);
    expect(info(req("gray-alpha.png", { format: "jpg" }).outPath)).toEqual([
      40,
      40,
      "L",
    ]);
  }, 60_000);

  it("upscales the first frame of an animation with a warning", async () => {
    const r = await worker.upscale(req("animated.gif"), 60_000);
    if (!r.ok) throw new Error(r.error);
    expect(r.outputWidth).toBe(64);
    expect(r.warnings.join(" ")).toMatch(/first frame/);
  }, 60_000);

  it("refuses images over the limits before upscaling", async () => {
    const big = await worker.upscale(
      req("large.png", { maxPixels: 1_000_000 }),
      60_000,
    );
    expect(big).toMatchObject({ ok: false, code: "too_large" });
    if (!big.ok) expect(big.error).toMatch(/1500x1000/);

    const wide = await worker.upscale(
      req("wide.png", { format: "webp" }),
      60_000,
    );
    expect(wide).toMatchObject({ ok: false, code: "too_large" });
    if (!wide.ok) expect(wide.error).toMatch(/WEBP.*16383/);
  });

  it("reports damaged files and keeps serving", async () => {
    const t = await worker.upscale(req("truncated.png"), 60_000);
    expect(t).toMatchObject({ ok: false, code: "decode" });
    const ok = await worker.upscale(req("photo.jpg", { scale: 2 }), 60_000);
    expect(ok.ok).toBe(true);
  }, 60_000);

  it("runs a whole batch through runUpscales", async () => {
    const input = normalizeInput({
      urls: [
        "https://x.org/photo.jpg",
        "https://x.org/not-image.png",
        "https://x.org/large.png",
      ],
      scale: 2,
      maxInputMegapixels: "1",
    });
    const items: OutputItem[] = [];
    const saved: string[] = [];
    const stats = await runUpscales(input, {
      download: async (job, path) => {
        const name = job.kind === "url" ? job.url.split("/").pop()! : "";
        await copyFile(join(dir, name), path);
        const body = readFileSync(path);
        return {
          path,
          bytes: body.length,
          head: body.subarray(0, 4096),
          contentType: null,
          fileName: name,
        };
      },
      probe: worker.probe,
      upscale: worker.upscale,
      budgetUnits: () => Infinity,
      emit: async (item) => {
        items.push(item);
        return { pushed: true, more: true };
      },
      saveFile: async (key, path) => {
        expect(existsSync(path)).toBe(true);
        saved.push(key);
        return `memory://${key}`;
      },
      deleteFile: async () => {},
      threads: 2,
      timeoutMs: () => 60_000,
    });
    expect(stats).toMatchObject({ upscaled: 1, failed: 2, billedUnits: 1 });
    expect(saved).toEqual(["upscaled-0001-photo.png"]);
    expect(items.find((i) => i.url.endsWith("photo.jpg"))).toMatchObject({
      inputWidth: 40,
      outputWidth: 80,
      outputHeight: 60,
      billedUnits: 1,
      error: null,
    });
    expect(items.find((i) => i.url.endsWith("not-image.png"))?.error).toMatch(
      /Not a supported image/,
    );
    expect(items.find((i) => i.url.endsWith("large.png"))?.error).toMatch(
      /over the 1 MP input limit/,
    );
  }, 120_000);
});
