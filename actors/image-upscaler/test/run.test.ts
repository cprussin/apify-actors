import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ImageError, type Downloaded } from "../src/download.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import {
  billableUnits,
  outputKey,
  runUpscales,
  type OutputItem,
  type RunDeps,
} from "../src/run.js";
import type { ProbeResult, UpscaleRequest } from "../src/worker.js";
import { makePng } from "./png.js";

/** url -> [width, height] of a generated PNG, or a download error. */
const files: Record<string, [number, number] | Error | Buffer> = {
  "https://x.org/small.png": [500, 400], // 0.2 MP: 1 unit
  "https://x.org/mid.png": [1000, 900], // 0.9 MP: 2 units
  "https://x.org/big.png": [1600, 1200], // 1.92 MP: 4 units
  "https://x.org/huge.png": [2000, 1500], // 3 MP: over the cap
  "https://x.org/404.png": new ImageError("Download failed: HTTP 404."),
  "https://x.org/page": Buffer.from("<!doctype html><html><body>hi</body>"),
  "https://x.org/broken.png": [10, 10],
};

function harness(
  raw: RawInput,
  opts: { budget?: number; upscaleError?: string } = {},
) {
  const items: OutputItem[] = [];
  const charges: number[] = [];
  const saved = new Map<string, string>();
  const deleted: string[] = [];
  const requests: UpscaleRequest[] = [];
  const sizes = new Map<string, [number, number]>();
  let budget = opts.budget ?? Infinity;
  const deps: RunDeps = {
    download: async (job, path): Promise<Downloaded> => {
      const f = files[job.kind === "url" ? job.url : job.input];
      if (!f) throw new Error("no such file");
      if (f instanceof Error) throw f;
      const body = Buffer.isBuffer(f) ? f : makePng(4, 4);
      if (!Buffer.isBuffer(f)) sizes.set(path, f);
      await writeFile(path, body);
      return {
        path,
        bytes: body.length,
        head: body.subarray(0, 4096),
        contentType: null,
        fileName: job.kind === "url" ? job.url.split("/").pop()! : job.key,
      };
    },
    probe: async (path): Promise<ProbeResult> => {
      const [width, height] = sizes.get(path)!;
      if (width === 10)
        return { ok: false, error: "Not a supported image.", code: "decode" };
      return { ok: true, format: "png", width, height, frames: 1 };
    },
    upscale: async (req) => {
      requests.push(req);
      if (opts.upscaleError)
        return { ok: false, error: opts.upscaleError, code: "internal" };
      const [w, h] = sizes.get(req.path)!;
      return {
        ok: true,
        inputWidth: w,
        inputHeight: h,
        outputWidth: w * req.scale,
        outputHeight: h * req.scale,
        outputBytes: 1234,
        hasAlpha: false,
        seconds: 1.234,
        cpuSeconds: 1.2,
        warnings: [],
      };
    },
    budgetUnits: () => budget,
    emit: async (item, units) => {
      if (units > 0) {
        if (budget < units) return { pushed: false, more: false };
        budget -= units;
        charges.push(units);
      }
      items.push(item);
      return { pushed: true, more: budget >= 1 };
    },
    saveFile: async (key, path, contentType) => {
      saved.set(key, contentType);
      expect(path).toBeTruthy();
      return `https://store/${key}`;
    },
    deleteFile: async (key) => {
      deleted.push(key);
    },
    threads: 1,
    timeoutMs: () => 1000,
    now: () => new Date("2026-10-08T00:00:00Z"),
  };
  return {
    items,
    charges,
    saved,
    deleted,
    requests,
    deps,
    run: () => runUpscales(normalizeInput(raw), deps),
  };
}

describe("billableUnits", () => {
  it("charges one unit per started 0.5 MP", () => {
    expect(billableUnits(1)).toBe(1);
    expect(billableUnits(500_000)).toBe(1);
    expect(billableUnits(500_001)).toBe(2);
    expect(billableUnits(1_000_000)).toBe(2);
    expect(billableUnits(2_000_000)).toBe(4);
  });
});

describe("outputKey", () => {
  it("builds safe, numbered record keys", () => {
    expect(outputKey(0, "My Photo (1).JPG", "png")).toBe(
      "upscaled-0001-My-Photo-(1).png",
    );
    expect(outputKey(41, null, "webp")).toBe("upscaled-0042.webp");
    expect(outputKey(0, "ünïcødé.png", "jpg")).toBe("upscaled-0001-n-c-d.jpg");
    expect(outputKey(0, "x".repeat(300), "png").length).toBeLessThan(100);
  });
});

describe("runUpscales", () => {
  it("upscales, stores and bills each image by input size", async () => {
    const h = harness({
      urls: ["https://x.org/small.png", "https://x.org/mid.png"],
      scale: 2,
      outputFormat: "webp",
    });
    const stats = await h.run();
    expect(stats).toMatchObject({
      upscaled: 2,
      failed: 0,
      billedUnits: 3,
      inputMegapixels: 1.1,
      stopReason: "done",
    });
    expect(h.charges).toEqual([1, 2]);
    const small = h.items.find((i) => i.url.endsWith("small.png"))!;
    expect(small).toMatchObject({
      sourceType: "url",
      fileName: "small.png",
      inputFormat: "png",
      inputWidth: 500,
      inputHeight: 400,
      inputMegapixels: 0.2,
      scale: 2,
      outputWidth: 1000,
      outputHeight: 800,
      outputFormat: "webp",
      outputKey: "upscaled-0001-small.webp",
      outputUrl: "https://store/upscaled-0001-small.webp",
      model: "realesr-general-x4v3",
      billedUnits: 1,
      processingSeconds: 1.23,
      error: null,
    });
    expect([...h.saved.values()]).toEqual(["image/webp", "image/webp"]);
    expect(h.requests[0]).toMatchObject({
      scale: 2,
      format: "webp",
      quality: 90,
      maxPixels: 2_000_000,
    });
  });

  it("returns free error items and keeps going", async () => {
    const h = harness({
      urls: [
        "https://x.org/404.png",
        "https://x.org/page",
        "https://x.org/huge.png",
        "https://x.org/broken.png",
        "not a url",
        "https://www.instagram.com/p/x/",
        "https://x.org/small.png",
      ],
    });
    const stats = await h.run();
    expect(stats).toMatchObject({ upscaled: 1, failed: 6, billedUnits: 1 });
    const err = (u: string) => h.items.find((i) => i.url.includes(u))?.error;
    expect(err("404")).toMatch(/HTTP 404/);
    expect(err("page")).toMatch(/web page/);
    expect(err("huge")).toMatch(/3 MP\), over the 2 MP input limit/);
    expect(err("broken")).toMatch(/Not a supported image/);
    expect(err("not a url")).toMatch(/Invalid URL/);
    expect(err("instagram")).toMatch(/Instagram/);
    expect(
      h.items.filter((i) => i.error).every((i) => i.billedUnits === 0),
    ).toBe(true);
    expect(h.charges).toEqual([1]);
    // Over-size images never reach the upscaler.
    expect(h.requests).toHaveLength(1);
  });

  it("honours a lower maxInputMegapixels", async () => {
    const h = harness({
      urls: ["https://x.org/mid.png"],
      maxInputMegapixels: "0.5",
    });
    await h.run();
    expect(h.items[0]!.error).toMatch(/over the 0.5 MP input limit/);
    expect(h.requests).toHaveLength(0);
  });

  it("reports upscaler failures for free", async () => {
    const h = harness(
      { urls: ["https://x.org/small.png"] },
      { upscaleError: "Out of memory." },
    );
    const stats = await h.run();
    expect(stats).toMatchObject({ upscaled: 0, failed: 1, billedUnits: 0 });
    expect(h.items[0]).toMatchObject({
      error: "Out of memory.",
      inputWidth: 500,
      billedUnits: 0,
    });
    expect(h.saved.size).toBe(0);
  });

  it("skips images the remaining budget can't pay for, then continues with smaller ones", async () => {
    const h = harness(
      {
        urls: [
          "https://x.org/mid.png",
          "https://x.org/big.png",
          "https://x.org/small.png",
        ],
      },
      { budget: 3 },
    );
    const stats = await h.run();
    expect(h.charges).toEqual([2, 1]);
    expect(stats).toMatchObject({
      upscaled: 2,
      skippedBudget: 1,
      billedUnits: 3,
      stopReason: "budget",
    });
    const big = h.items.find((i) => i.url.endsWith("big.png"))!;
    expect(big.error).toMatch(/costs 4 events, more than the remaining/);
    expect(big.billedUnits).toBe(0);
  });

  it("stops when the budget is used up", async () => {
    const h = harness(
      {
        urls: [
          "https://x.org/small.png",
          "https://x.org/mid.png",
          "https://x.org/small.png?2",
        ],
      },
      { budget: 1 },
    );
    const stats = await h.run();
    expect(h.charges).toEqual([1]);
    expect(stats.upscaled).toBe(1);
    expect(stats.stopReason).toBe("budget");
    expect(h.requests).toHaveLength(1);
  });

  it("deletes a stored file that could not be charged", async () => {
    const raw = { urls: ["https://x.org/mid.png"] };
    const h = harness(raw);
    // The charge fails (e.g. the budget was used up by a concurrent run).
    const stats = await runUpscales(normalizeInput(raw), {
      ...h.deps,
      emit: async () => ({ pushed: false, more: false }),
    });
    expect(h.items).toHaveLength(0);
    expect(stats).toMatchObject({ upscaled: 0, stopReason: "budget" });
    expect(h.deleted).toEqual(["upscaled-0001-mid.png"]);
  });
});
