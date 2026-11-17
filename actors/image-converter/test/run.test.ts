import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { sampleImage } from "../src/convert.js";
import { ImageError, type Downloaded } from "../src/download.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import {
  EVENTS,
  eventFor,
  outputKey,
  runConversions,
  savedPercent,
  type EventName,
  type OutputItem,
  type RunDeps,
} from "../src/run.js";
import { makeBmp } from "./bmp.js";
import { makePng } from "./png.js";

const PRICES: Record<EventName, number> = {
  "image-converted": 0.002,
  "image-converted-large": 0.004,
};

/** url -> file body, or a download error. */
const files: Record<string, Buffer | Error> = {
  "https://x.org/small.png": makePng(300, 200),
  "https://x.org/alpha.png": makePng(40, 40, true),
  "https://x.org/photo.bmp": makeBmp(30, 20, 24, (x, y) => [x * 8, y * 12, 99]),
  "https://x.org/404.png": new ImageError("Download failed: HTTP 404."),
  "https://x.org/page": Buffer.from("<!doctype html><html><body>hi</body>"),
  "https://x.org/broken.png": Buffer.concat([makePng(10, 10).subarray(0, 40)]),
};

beforeAll(async () => {
  // 4000x3100 = 12.4 MP: billed as large. Flat colour keeps the test fast.
  files["https://x.org/large.png"] = await sharp({
    create: {
      width: 4000,
      height: 3100,
      channels: 3,
      background: "#3366aa",
    },
  })
    .png()
    .toBuffer();
});

function harness(
  raw: RawInput,
  opts: { budgetUsd?: number; heicError?: string } = {},
) {
  const items: OutputItem[] = [];
  const charges: EventName[] = [];
  const saved = new Map<string, string>();
  const deleted: string[] = [];
  let budget = opts.budgetUsd ?? Infinity;
  const deps: RunDeps = {
    download: async (job, path): Promise<Downloaded> => {
      const f = files[job.kind === "url" ? job.url : job.input];
      if (!f) throw new Error("no such file");
      if (f instanceof Error) throw f;
      await writeFile(path, f);
      return {
        path,
        bytes: f.length,
        head: f.subarray(0, 4096),
        contentType: null,
        fileName: job.kind === "url" ? job.url.split("/").pop()! : job.key,
      };
    },
    decodeHeic: async () => {
      throw new Error(opts.heicError ?? "HEIC decoding failed: test");
    },
    sample: () => sampleImage(64, 48),
    canCharge: (event) => budget >= PRICES[event],
    emit: async (item, event) => {
      if (event) {
        if (budget < PRICES[event]) return { pushed: false, more: false };
        budget -= PRICES[event];
        charges.push(event);
      }
      items.push(item);
      return { pushed: true, more: budget >= PRICES[EVENTS.regular] };
    },
    saveFile: async (key, data, contentType) => {
      saved.set(key, contentType);
      expect(data.length).toBeGreaterThan(0);
      return `https://store/${key}`;
    },
    deleteFile: async (key) => {
      deleted.push(key);
    },
    now: () => new Date("2026-11-17T00:00:00Z"),
  };
  return {
    items,
    charges,
    saved,
    deleted,
    deps,
    run: () => runConversions(normalizeInput(raw), deps),
  };
}

describe("helpers", () => {
  it("prices by input pixels", () => {
    expect(eventFor(12_000_000)).toBe("image-converted");
    expect(eventFor(12_000_001)).toBe("image-converted-large");
  });

  it("computes the percentage saved", () => {
    expect(savedPercent(1000, 250)).toBe(75);
    expect(savedPercent(1000, 1500)).toBe(-50);
    expect(savedPercent(0, 10)).toBeNull();
  });

  it("builds safe, numbered record keys", () => {
    expect(outputKey(0, "My Photo (1).PNG", "jpeg")).toBe(
      "converted-0001-My-Photo-(1).jpg",
    );
    expect(outputKey(41, null, "webp")).toBe("converted-0042.webp");
    expect(outputKey(0, "x".repeat(300), "avif").length).toBeLessThanOrEqual(
      100,
    );
  });
});

describe("runConversions", () => {
  it("converts the generated sample when no input is given", async () => {
    const h = harness({});
    const stats = await h.run();
    expect(stats).toMatchObject({ converted: 1, failed: 0 });
    expect(h.charges).toEqual(["image-converted"]);
    expect(h.items[0]).toMatchObject({
      url: "sample-640x480.png",
      sourceType: "sample",
      inputFormat: "png",
      inputWidth: 64,
      outputFormat: "webp",
      outputKey: "converted-0001-sample-640x480.webp",
      chargedEvent: "image-converted",
      error: null,
    });
  });

  it("converts, stores and reports each image", async () => {
    const h = harness({
      urls: ["https://x.org/small.png", "https://x.org/photo.bmp"],
      outputFormat: "jpeg",
      maxWidth: 150,
    });
    const stats = await h.run();
    expect(stats).toMatchObject({
      converted: 2,
      failed: 0,
      stopReason: "done",
    });
    const small = h.items[0]!;
    expect(small).toMatchObject({
      url: "https://x.org/small.png",
      sourceType: "url",
      fileName: "small.png",
      inputFormat: "png",
      inputWidth: 300,
      inputHeight: 200,
      inputMegapixels: 0.06,
      outputFormat: "jpeg",
      outputWidth: 150,
      outputHeight: 100,
      quality: 80,
      outputKey: "converted-0001-small.jpg",
      outputUrl: "https://store/converted-0001-small.jpg",
      chargedEvent: "image-converted",
      warning: null,
      error: null,
      convertedAt: "2026-11-17T00:00:00.000Z",
    });
    expect(small.savedPercent).toBe(
      savedPercent(small.inputBytes!, small.outputBytes!),
    );
    expect(h.items[1]).toMatchObject({
      inputFormat: "bmp",
      inputWidth: 30,
      outputWidth: 30,
    });
    expect([...h.saved.values()]).toEqual(["image/jpeg", "image/jpeg"]);
  });

  it("bills images over 12 MP as large", async () => {
    const h = harness({
      urls: ["https://x.org/large.png"],
      outputFormat: "jpeg",
      maxWidth: 200,
    });
    await h.run();
    expect(h.charges).toEqual(["image-converted-large"]);
    expect(h.items[0]).toMatchObject({
      inputMegapixels: 12.4,
      outputWidth: 200,
      chargedEvent: "image-converted-large",
    });
  });

  it("returns free error items and keeps going", async () => {
    const h = harness({
      urls: [
        "https://x.org/404.png",
        "https://x.org/page",
        "https://x.org/broken.png",
        "https://x.org/large.png",
        "not a url",
        "https://www.instagram.com/p/x/",
        "https://x.org/alpha.png",
      ],
      outputFormat: "jpeg",
      maxInputMegapixels: 12,
    });
    const stats = await h.run();
    expect(stats).toMatchObject({ converted: 1, failed: 6 });
    const err = (u: string) => h.items.find((i) => i.url.includes(u))?.error;
    expect(err("404")).toMatch(/HTTP 404/);
    expect(err("page")).toMatch(/web page/);
    expect(err("broken")).toMatch(/Could not read the image|Conversion failed/);
    expect(err("large")).toMatch(/12.4 MP\), over the 12 MP input limit/);
    expect(err("not a url")).toMatch(/Invalid URL/);
    expect(err("instagram")).toMatch(/Instagram/);
    expect(
      h.items.filter((i) => i.error).every((i) => i.chargedEvent === null),
    ).toBe(true);
    expect(h.charges).toEqual(["image-converted"]);
    expect(h.items.find((i) => i.url.endsWith("alpha.png"))!.warning).toMatch(
      /flattened onto white/,
    );
  });

  it("reports HEIC decoding failures for free", async () => {
    files["https://x.org/phone.heic"] = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypheic\0\0\0\0mif1heic", "latin1"),
    ]);
    const h = harness(
      { urls: ["https://x.org/phone.heic"] },
      { heicError: "HEIC decoding failed: bad file" },
    );
    await h.run();
    expect(h.items[0]).toMatchObject({
      inputFormat: "heic",
      error: "HEIC decoding failed: bad file",
      chargedEvent: null,
    });
  });

  it("skips a large image the budget can't pay for, then converts smaller ones", async () => {
    const h = harness(
      {
        urls: ["https://x.org/large.png", "https://x.org/small.png"],
        outputFormat: "jpeg",
        maxWidth: 100,
      },
      { budgetUsd: 0.003 },
    );
    const stats = await h.run();
    expect(h.charges).toEqual(["image-converted"]);
    expect(stats).toMatchObject({
      converted: 1,
      skippedBudget: 1,
      stopReason: "budget",
    });
    expect(h.items[0]!.error).toMatch(
      /doesn't cover one image-converted-large/,
    );
  });

  it("stops when the budget is used up", async () => {
    const h = harness(
      {
        urls: [
          "https://x.org/small.png",
          "https://x.org/alpha.png",
          "https://x.org/photo.bmp",
        ],
      },
      { budgetUsd: 0.002 },
    );
    const stats = await h.run();
    expect(h.charges).toEqual(["image-converted"]);
    expect(stats).toMatchObject({ converted: 1, stopReason: "budget" });
    expect(h.items).toHaveLength(1);
  });

  it("deletes a stored file that could not be charged", async () => {
    const raw = { urls: ["https://x.org/small.png"] };
    const h = harness(raw);
    const stats = await runConversions(normalizeInput(raw), {
      ...h.deps,
      emit: async () => ({ pushed: false, more: false }),
    });
    expect(h.items).toHaveLength(0);
    expect(stats).toMatchObject({ converted: 0, stopReason: "budget" });
    expect(h.deleted).toEqual(["converted-0001-small.webp"]);
  });
});
