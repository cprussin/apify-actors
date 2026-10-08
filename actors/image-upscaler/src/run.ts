import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectImage } from "./detect.js";
import { ImageError, type Downloaded } from "./download.js";
import type { NormalizedInput, OutputFormat, Scale, Source } from "./input.js";
import type { Probe, Upscale, UpscaleResult } from "./worker.js";

export const MODEL = "realesr-general-x4v3";
/** One `image-upscaled` event per started half megapixel of input. */
export const PIXELS_PER_UNIT = 500_000;

export type SourceType = "url" | "kv";

/** One dataset item: an upscaled image or a failure. */
export interface OutputItem {
  /** Image URL, or "storeId/key" for a key-value store record. */
  url: string;
  sourceType: SourceType;
  fileName: string | null;
  inputFormat: string | null;
  inputBytes: number | null;
  inputWidth: number | null;
  inputHeight: number | null;
  inputMegapixels: number | null;
  scale: Scale;
  outputWidth: number | null;
  outputHeight: number | null;
  outputFormat: OutputFormat;
  outputBytes: number | null;
  outputKey: string | null;
  outputUrl: string | null;
  model: string;
  billedUnits: number;
  processingSeconds: number | null;
  warning: string | null;
  error: string | null;
  upscaledAt: string;
}

export interface EmitResult {
  pushed: boolean;
  more: boolean;
}

export type Job = Extract<Source, { kind: "url" | "kv" }>;

export interface RunDeps {
  /** Saves the job's file to `path`. Throws ImageError for user-facing failures. */
  download: (job: Job, path: string) => Promise<Downloaded>;
  probe: Probe;
  upscale: Upscale;
  /** Units (events) the remaining budget pays for (Infinity when unlimited). */
  budgetUnits: () => number;
  /**
   * Push one item, charging `units` events (0 for failures). `pushed:
   * false` when the budget was used up; `more: false` to stop.
   */
  emit: (item: OutputItem, units: number) => Promise<EmitResult>;
  /** Stores the upscaled file; returns its public URL. */
  saveFile: (key: string, path: string, contentType: string) => Promise<string>;
  /** Removes a stored file that was not paid for. */
  deleteFile: (key: string) => Promise<void>;
  threads: number;
  /** Upscaling timeout for an image of this many input pixels. */
  timeoutMs: (pixels: number) => number;
  log?: (msg: string) => void;
  now?: () => Date;
}

export interface RunStats {
  upscaled: number;
  failed: number;
  skippedBudget: number;
  billedUnits: number;
  inputMegapixels: number;
  stopReason: "done" | "budget";
}

/** Parallel downloads: the next image downloads while one is upscaled. */
export const DOWNLOAD_CONCURRENCY = 2;

export const CONTENT_TYPES: Record<OutputFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

const errMsg = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 500);

export const billableUnits = (pixels: number) =>
  Math.max(1, Math.ceil(pixels / PIXELS_PER_UNIT));

export const megapixels = (pixels: number) => Math.round(pixels / 10_000) / 100;

/** Key-value store key for an output image: upscaled-0001-name.png. */
export function outputKey(
  index: number,
  fileName: string | null,
  format: OutputFormat,
): string {
  const base = (fileName ?? "")
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[^A-Za-z0-9!\-_.'()]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  const n = String(index + 1).padStart(4, "0");
  return `upscaled-${n}${base ? `-${base}` : ""}.${format}`;
}

/** Map with at most `limit` calls in flight. `fn` returning false stops. */
export async function forEachLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<boolean>,
): Promise<number> {
  let next = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && next < items.length) {
      const item = items[next++]!;
      if (!(await fn(item))) stopped = true;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return items.length - next;
}

/** Runs `fn` calls one at a time, in call order. */
function serializer() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => {});
    return run;
  };
}

export async function runUpscales(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const serial = serializer();
  const stats: RunStats = {
    upscaled: 0,
    failed: 0,
    skippedBudget: 0,
    billedUnits: 0,
    inputMegapixels: 0,
    stopReason: "done",
  };

  const blank = (s: Source, extra: Partial<OutputItem> = {}): OutputItem => ({
    url: s.kind === "url" ? s.url : s.input,
    sourceType: s.kind === "kv" ? "kv" : "url",
    fileName: null,
    inputFormat: null,
    inputBytes: null,
    inputWidth: null,
    inputHeight: null,
    inputMegapixels: null,
    scale: input.scale,
    outputWidth: null,
    outputHeight: null,
    outputFormat: input.outputFormat,
    outputBytes: null,
    outputKey: null,
    outputUrl: null,
    model: MODEL,
    billedUnits: 0,
    processingSeconds: null,
    warning: null,
    error: null,
    upscaledAt: now().toISOString(),
    ...extra,
  });

  const fail = async (item: OutputItem, error: string) => {
    stats.failed += 1;
    log(`${item.url}: ${error}`);
    return (await deps.emit({ ...item, error }, 0)).more;
  };

  const tmp = await mkdtemp(join(tmpdir(), "upscale-"));

  // Upscale one downloaded image (serialized). Returns false to stop.
  const upscaleOne = async (
    job: Job,
    file: Downloaded,
    format: string,
  ): Promise<boolean> => {
    const outPath = join(tmp, `out-${job.index}`);
    const item0 = blank(job, {
      fileName: file.fileName,
      inputFormat: format,
      inputBytes: file.bytes,
    });
    try {
      if (deps.budgetUnits() < 1) {
        stats.stopReason = "budget";
        return false;
      }
      const info = await deps.probe(file.path);
      if (!info.ok) return await fail(item0, info.error);
      const pixels = info.width * info.height;
      const sized = {
        ...item0,
        inputWidth: info.width,
        inputHeight: info.height,
        inputMegapixels: megapixels(pixels),
      };
      if (pixels > input.maxInputPixels)
        return await fail(
          sized,
          `The image is ${info.width}x${info.height} (${megapixels(pixels)} MP), over the ${input.maxInputPixels / 1e6} MP input limit (maxInputMegapixels).`,
        );
      const units = billableUnits(pixels);
      const budget = deps.budgetUnits();
      if (units > budget) {
        stats.skippedBudget += 1;
        stats.stopReason = "budget";
        await fail(
          sized,
          `Not upscaled: a ${megapixels(pixels)} MP image costs ${units} events, more than the remaining max charge per run pays for (${Math.floor(budget)}).`,
        );
        // Smaller images may still fit.
        return deps.budgetUnits() >= 1;
      }

      let res: UpscaleResult;
      try {
        res = await deps.upscale(
          {
            path: file.path,
            outPath,
            scale: input.scale,
            format: input.outputFormat,
            quality: input.quality,
            threads: deps.threads,
            maxPixels: input.maxInputPixels,
          },
          deps.timeoutMs(pixels),
        );
      } catch (e) {
        res = {
          ok: false,
          error: `Upscaling failed: ${errMsg(e)}`,
          code: "internal",
        };
      }
      if (!res.ok) return await fail(sized, res.error);

      const key = outputKey(job.index, file.fileName, input.outputFormat);
      const outputUrl = await deps.saveFile(
        key,
        outPath,
        CONTENT_TYPES[input.outputFormat],
      );
      const item: OutputItem = {
        ...sized,
        outputWidth: res.outputWidth,
        outputHeight: res.outputHeight,
        outputBytes: res.outputBytes,
        outputKey: key,
        outputUrl,
        billedUnits: units,
        processingSeconds: Math.round(res.seconds * 100) / 100,
        warning: res.warnings.join(" ") || null,
      };
      const emitted = await deps.emit(item, units);
      if (emitted.pushed) {
        stats.upscaled += 1;
        stats.billedUnits += units;
        stats.inputMegapixels =
          Math.round((stats.inputMegapixels + pixels / 1e6) * 100) / 100;
      } else {
        // Not paid for (budget used up): don't leave the file behind.
        await deps.deleteFile(key).catch(() => {});
      }
      if (!emitted.more) stats.stopReason = "budget";
      return emitted.more;
    } finally {
      await rm(file.path, { force: true }).catch(() => {});
      await rm(outPath, { force: true }).catch(() => {});
    }
  };

  const one = async (s: Source): Promise<boolean> => {
    if (s.kind === "invalid") return fail(blank(s), s.error);
    if (deps.budgetUnits() < 1) {
      stats.stopReason = "budget";
      return false;
    }
    const path = join(tmp, `in-${s.index}`);
    let file: Downloaded;
    try {
      file = await deps.download(s, path);
    } catch (e) {
      await rm(path, { force: true }).catch(() => {});
      return fail(
        blank(s),
        e instanceof ImageError ? e.message : `Download failed: ${errMsg(e)}`,
      );
    }
    const detected = detectImage(file.head);
    if (!detected.format) {
      await rm(path, { force: true }).catch(() => {});
      return fail(
        blank(s, { fileName: file.fileName, inputBytes: file.bytes }),
        detected.error,
      );
    }
    const format = detected.format;
    // Downloads run in parallel; upscaling and charging one at a time.
    return serial(() => upscaleOne(s, file, format));
  };

  try {
    const left = await forEachLimit(input.sources, DOWNLOAD_CONCURRENCY, one);
    if (left) log(`${left} image(s) not started (max charge reached).`);
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
  return stats;
}
