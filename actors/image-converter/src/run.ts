import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BmpError, bmpSize, decodeBmp } from "./bmp.js";
import {
  CONTENT_TYPES,
  convert,
  EXTENSIONS,
  probe,
  type ConvertResult,
  type Decodable,
  type ProbeInfo,
} from "./convert.js";
import { detectImage, type ImageFormat } from "./detect.js";
import { ImageError, type Downloaded } from "./download.js";
import {
  LARGE_PIXELS,
  SAMPLE_NAME,
  type NormalizedInput,
  type OutputFormat,
  type Source,
} from "./input.js";

export const EVENTS = {
  regular: "image-converted",
  large: "image-converted-large",
} as const;
export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

export type SourceType = "url" | "kv" | "dataset" | "sample";

/** One dataset item: a converted image or a failure. */
export interface OutputItem {
  /** Image URL, "storeId/key" for a key-value store record, or the sample's name. */
  url: string;
  sourceType: SourceType;
  fileName: string | null;
  inputFormat: string | null;
  inputBytes: number | null;
  inputWidth: number | null;
  inputHeight: number | null;
  inputMegapixels: number | null;
  outputFormat: OutputFormat;
  outputWidth: number | null;
  outputHeight: number | null;
  outputBytes: number | null;
  savedPercent: number | null;
  quality: number | null;
  outputKey: string | null;
  outputUrl: string | null;
  chargedEvent: EventName | null;
  warning: string | null;
  error: string | null;
  convertedAt: string;
}

export interface EmitResult {
  pushed: boolean;
  more: boolean;
}

export type Job = Extract<Source, { kind: "url" | "kv" }>;

export interface RunDeps {
  /** Saves the job's file to `path`. Throws ImageError for user-facing failures. */
  download: (job: Job, path: string) => Promise<Downloaded>;
  /** HEIC -> PNG (heic.ts). */
  decodeHeic: (
    inPath: string,
    outPath: string,
    timeoutMs: number,
  ) => Promise<void>;
  /** The generated test image (PNG). */
  sample: () => Promise<Buffer>;
  /** Whether the remaining budget pays for one more of this event. */
  canCharge: (event: EventName) => boolean;
  /**
   * Push one item, charging `event` once (null for failures). `pushed:
   * false` when the budget was used up; `more: false` to stop.
   */
  emit: (item: OutputItem, event: EventName | null) => Promise<EmitResult>;
  /** Stores the converted file; returns its public URL. */
  saveFile: (key: string, data: Buffer, contentType: string) => Promise<string>;
  /** Removes a stored file that was not paid for. */
  deleteFile: (key: string) => Promise<void>;
  log?: (msg: string) => void;
  now?: () => Date;
}

export interface RunStats {
  converted: number;
  convertedLarge: number;
  failed: number;
  skippedBudget: number;
  bytesIn: number;
  bytesOut: number;
  stopReason: "done" | "budget";
}

/** Parallel downloads: the next image downloads while one is converted. */
export const DOWNLOAD_CONCURRENCY = 2;

const errMsg = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 500);

export const megapixels = (pixels: number) => Math.round(pixels / 10_000) / 100;

export const eventFor = (pixels: number): EventName =>
  pixels > LARGE_PIXELS ? EVENTS.large : EVENTS.regular;

/** Percent smaller than the input (negative when the output is bigger). */
export const savedPercent = (bytesIn: number, bytesOut: number) =>
  bytesIn > 0 ? Math.round((1 - bytesOut / bytesIn) * 1000) / 10 : null;

/** Encoding time limit: generous for 0.25 CPU core at 1 GB. */
export const convertTimeoutSecs = (pixels: number) =>
  Math.min(900, Math.round(60 + (8 * pixels) / 1e6));

/** Key-value store key for an output image: converted-0001-name.webp. */
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
  return `converted-${n}${base ? `-${base}` : ""}.${EXTENSIONS[format]}`;
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

/**
 * Hands out turns in claim order; each turn's `fn` runs only after every
 * earlier turn's has settled. Every claimed turn must be used exactly once.
 */
function turns() {
  let tail: Promise<unknown> = Promise.resolve();
  return () => {
    const prev = tail;
    let release!: () => void;
    tail = new Promise<void>((r) => (release = r));
    return async <T>(fn: () => Promise<T>): Promise<T> => {
      await prev;
      try {
        return await fn();
      } finally {
        release();
      }
    };
  };
}

const sourceType = (s: Source): SourceType =>
  s.kind === "kv"
    ? "kv"
    : s.kind === "sample"
      ? "sample"
      : s.kind === "url" && s.fromDataset
        ? "dataset"
        : "url";

export async function runConversions(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const nextTurn = turns();
  const stats: RunStats = {
    converted: 0,
    convertedLarge: 0,
    failed: 0,
    skippedBudget: 0,
    bytesIn: 0,
    bytesOut: 0,
    stopReason: "done",
  };

  const blank = (s: Source, extra: Partial<OutputItem> = {}): OutputItem => ({
    url: s.kind === "url" ? s.url : s.input,
    sourceType: sourceType(s),
    fileName: null,
    inputFormat: null,
    inputBytes: null,
    inputWidth: null,
    inputHeight: null,
    inputMegapixels: null,
    outputFormat: input.outputFormat,
    outputWidth: null,
    outputHeight: null,
    outputBytes: null,
    savedPercent: null,
    quality: null,
    outputKey: null,
    outputUrl: null,
    chargedEvent: null,
    warning: null,
    error: null,
    convertedAt: now().toISOString(),
    ...extra,
  });

  const fail = async (item: OutputItem, error: string) => {
    stats.failed += 1;
    log(`${item.url}: ${error}`);
    return (await deps.emit({ ...item, error }, null)).more;
  };

  const tmp = await mkdtemp(join(tmpdir(), "convert-"));

  /** Turns the downloaded file into something sharp reads. */
  const decodable = async (
    file: Downloaded,
    format: ImageFormat,
    index: number,
  ): Promise<Decodable> => {
    if (format === "heic") {
      // Own folder: heif-convert may also write depth or gain-map images.
      const dir = join(tmp, `heic-${index}`);
      await mkdir(dir, { recursive: true });
      const out = join(dir, "decoded.png");
      await deps.decodeHeic(file.path, out, input.timeoutMs * 2);
      return { kind: "file", path: out };
    }
    if (format === "bmp") {
      const buf = await readFile(file.path);
      const { width, height } = bmpSize(buf);
      // Over the limit: report the size without allocating the pixels
      // (the caller fails it before converting).
      if (width * height > input.maxInputPixels)
        return {
          kind: "raw",
          image: { data: Buffer.alloc(0), width, height, channels: 3 },
        };
      return { kind: "raw", image: decodeBmp(buf, input.maxInputPixels) };
    }
    // SVG from a buffer: no base path, so librsvg can't load local files.
    if (format === "svg")
      return { kind: "buffer", data: await readFile(file.path) };
    return { kind: "file", path: file.path };
  };

  // Convert one downloaded image (serialized). Returns false to stop.
  const convertOne = async (
    job: Source,
    file: Downloaded,
    format: ImageFormat,
  ): Promise<boolean> => {
    const item0 = blank(job, {
      fileName: file.fileName,
      inputFormat: format,
      inputBytes: file.bytes,
    });
    try {
      if (!deps.canCharge(EVENTS.regular)) {
        stats.stopReason = "budget";
        return false;
      }
      let src: Decodable;
      let info: ProbeInfo;
      try {
        src = await decodable(file, format, job.index);
        info = await probe(src);
      } catch (e) {
        return await fail(
          item0,
          e instanceof BmpError || /HEIC/.test(errMsg(e))
            ? errMsg(e)
            : `Could not read the image: ${errMsg(e)}`,
        );
      }
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
      const event = eventFor(pixels);
      if (!deps.canCharge(event)) {
        stats.skippedBudget += 1;
        stats.stopReason = "budget";
        await fail(
          sized,
          `Not converted: the remaining max charge per run doesn't cover one ${event} event.`,
        );
        // Smaller images may still fit.
        return deps.canCharge(EVENTS.regular);
      }

      let res: ConvertResult;
      try {
        res = await convert(src, info, {
          format: input.outputFormat,
          quality: input.quality,
          targetBytes: input.targetBytes,
          maxWidth: input.maxWidth,
          maxHeight: input.maxHeight,
          fit: input.fit,
          stripMetadata: input.stripMetadata,
          maxInputPixels: input.maxInputPixels,
          timeoutSecs: convertTimeoutSecs(pixels),
        });
      } catch (e) {
        return await fail(sized, `Conversion failed: ${errMsg(e)}`);
      }
      const warnings = [...res.warnings];
      if (format === "heic" && !input.stripMetadata)
        warnings.push("HEIC metadata (EXIF) is not carried over.");

      const key = outputKey(job.index, file.fileName, input.outputFormat);
      const outputUrl = await deps.saveFile(
        key,
        res.data,
        CONTENT_TYPES[input.outputFormat],
      );
      const item: OutputItem = {
        ...sized,
        outputWidth: res.width,
        outputHeight: res.height,
        outputBytes: res.data.length,
        savedPercent: savedPercent(file.bytes, res.data.length),
        quality: res.quality,
        outputKey: key,
        outputUrl,
        chargedEvent: event,
        warning: warnings.join(" ") || null,
      };
      const emitted = await deps.emit(item, event);
      if (emitted.pushed) {
        stats.converted += 1;
        if (event === EVENTS.large) stats.convertedLarge += 1;
        stats.bytesIn += file.bytes;
        stats.bytesOut += res.data.length;
      } else {
        // Not paid for (budget used up): don't leave the file behind.
        await deps.deleteFile(key).catch(() => {});
      }
      if (!emitted.more) stats.stopReason = "budget";
      return emitted.more;
    } finally {
      await rm(file.path, { force: true }).catch(() => {});
      await rm(join(tmp, `heic-${job.index}`), {
        recursive: true,
        force: true,
      }).catch(() => {});
    }
  };

  // Download (in parallel) and return the step that finishes the job.
  const prepare = async (s: Source): Promise<() => Promise<boolean>> => {
    if (s.kind === "invalid") return () => fail(blank(s), s.error);
    if (!deps.canCharge(EVENTS.regular))
      return async () => {
        stats.stopReason = "budget";
        return false;
      };
    const path = join(tmp, `in-${s.index}`);
    let file: Downloaded;
    try {
      if (s.kind === "sample") {
        const data = await deps.sample();
        await writeFile(path, data);
        file = {
          path,
          bytes: data.length,
          head: data.subarray(0, 4096),
          contentType: "image/png",
          fileName: SAMPLE_NAME,
        };
      } else file = await deps.download(s, path);
    } catch (e) {
      await rm(path, { force: true }).catch(() => {});
      return () =>
        fail(
          blank(s),
          e instanceof ImageError ? e.message : `Download failed: ${errMsg(e)}`,
        );
    }
    const detected = detectImage(file.head);
    if (!detected.format) {
      await rm(path, { force: true }).catch(() => {});
      const error = detected.error;
      return () =>
        fail(
          blank(s, { fileName: file.fileName, inputBytes: file.bytes }),
          error,
        );
    }
    const format = detected.format;
    return () => convertOne(s, file, format);
  };

  const one = async (s: Source): Promise<boolean> => {
    // Claimed before any await, so turns follow input order: downloads run
    // in parallel, but converting, charging and output happen one at a
    // time in input order (deterministic budget use and dataset order).
    const turn = nextTurn();
    let step: () => Promise<boolean>;
    try {
      step = await prepare(s);
    } catch (e) {
      step = () => Promise.reject(e);
    }
    return turn(step);
  };

  try {
    const left = await forEachLimit(input.sources, DOWNLOAD_CONCURRENCY, one);
    if (left) log(`${left} image(s) not started (max charge reached).`);
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
  return stats;
}
