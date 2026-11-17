import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { notMediaError } from "./detect.js";
import { MediaError, type Downloaded } from "./download.js";
import {
  OUTPUT_CODECS,
  type ConvertPlan,
  type MediaInfo,
  type MediaTools,
} from "./ffmpeg.js";
import {
  isAudioFormat,
  SAMPLE_NAME,
  type NormalizedInput,
  type OutputFormat,
  type Source,
} from "./input.js";
import {
  above1080p,
  billedMinutes,
  EVENTS,
  eventFor,
  fitResolution,
  savedPercent,
  targetBitrates,
  type EventName,
} from "./plan.js";

export type SourceType = "url" | "kv" | "sample";

/** One dataset item: a converted file or a failure. */
export interface OutputItem {
  /** File URL, "storeId/key" for a key-value store record, or the sample's name. */
  url: string;
  sourceType: SourceType;
  fileName: string | null;
  inputBytes: number | null;
  inputContainer: string | null;
  inputVideoCodec: string | null;
  inputAudioCodec: string | null;
  inputWidth: number | null;
  inputHeight: number | null;
  inputDurationSeconds: number | null;
  /** bit/s */
  inputBitrate: number | null;
  outputFormat: OutputFormat;
  outputVideoCodec: string | null;
  outputAudioCodec: string | null;
  outputWidth: number | null;
  outputHeight: number | null;
  outputDurationSeconds: number | null;
  outputBitrate: number | null;
  outputBytes: number | null;
  savedPercent: number | null;
  /** H.264-scale CRF used; null in target-size mode and for audio. */
  crf: number | null;
  targetMb: number | null;
  outputKey: string | null;
  outputUrl: string | null;
  chargedEvent: EventName | null;
  chargedMinutes: number | null;
  processingSeconds: number | null;
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
  /** Saves the job's file to `path`. Throws MediaError for user-facing failures. */
  download: (job: Job, path: string) => Promise<Downloaded>;
  media: MediaTools;
  /** FFmpeg threads (one per CPU core). */
  threads: number;
  /** CPU cores available (0.25 at 1 GB on Apify), for time limits. */
  cpus: number;
  /** Whether the remaining budget pays for `count` of this event. */
  canCharge: (event: EventName, count: number) => boolean;
  /**
   * Push one item, charging `count` x `event` (null for failures). `pushed:
   * false` when the budget was used up; `more: false` to stop.
   */
  emit: (
    item: OutputItem,
    charge: { event: EventName; count: number } | null,
  ) => Promise<EmitResult>;
  /** Stores the converted file; returns its public URL. */
  saveFile: (key: string, path: string, contentType: string) => Promise<string>;
  /** Removes a stored file that was not paid for. */
  deleteFile: (key: string) => Promise<void>;
  log?: (msg: string) => void;
  now?: () => Date;
  clock?: () => number;
}

export interface RunStats {
  converted: number;
  failed: number;
  skippedBudget: number;
  minutes: Partial<Record<EventName, number>>;
  bytesIn: number;
  bytesOut: number;
  stopReason: "done" | "budget";
}

/** Parallel downloads: the next file downloads while one is converted. */
export const DOWNLOAD_CONCURRENCY = 2;

export const EXTENSIONS: Record<OutputFormat, string> = {
  mp4: "mp4",
  webm: "webm",
  mp3: "mp3",
  m4a: "m4a",
  wav: "wav",
};

export const CONTENT_TYPES: Record<OutputFormat, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
};

const errMsg = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 500);

/** Key-value store key for an output file: converted-0001-name.mp4. */
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

/**
 * Time limit for one encode: a generous backstop. 1080p H.264 took ~50 s
 * of one core per minute of video in our tests; 4K input decodes ~4x
 * slower.
 */
export function convertTimeoutMs(
  outSecs: number,
  input: { width: number; height: number } | null,
  cpus: number,
): number {
  const factor = input ? Math.max(1, (input.width * input.height) / 2e6) : 0.1;
  return Math.round(300 + (outSecs * 2 * factor) / Math.max(cpus, 0.25)) * 1000;
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

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export async function runConversions(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const clock = deps.clock ?? (() => performance.now());
  const nextTurn = turns();
  const format = input.outputFormat;
  const audioOut = isAudioFormat(format);
  // The cheapest minute this run can bill: worth starting another file?
  const cheapest: EventName = audioOut ? EVENTS.audio : EVENTS.p480;
  const stats: RunStats = {
    converted: 0,
    failed: 0,
    skippedBudget: 0,
    minutes: {},
    bytesIn: 0,
    bytesOut: 0,
    stopReason: "done",
  };
  const targetMb = input.targetBytes ? input.targetBytes / 1024 / 1024 : null;

  const blank = (s: Source, extra: Partial<OutputItem> = {}): OutputItem => ({
    url: s.kind === "url" ? s.url : s.input,
    sourceType: s.kind === "kv" ? "kv" : s.kind === "sample" ? "sample" : "url",
    fileName: null,
    inputBytes: null,
    inputContainer: null,
    inputVideoCodec: null,
    inputAudioCodec: null,
    inputWidth: null,
    inputHeight: null,
    inputDurationSeconds: null,
    inputBitrate: null,
    outputFormat: format,
    outputVideoCodec: null,
    outputAudioCodec: null,
    outputWidth: null,
    outputHeight: null,
    outputDurationSeconds: null,
    outputBitrate: null,
    outputBytes: null,
    savedPercent: null,
    crf: null,
    targetMb,
    outputKey: null,
    outputUrl: null,
    chargedEvent: null,
    chargedMinutes: null,
    processingSeconds: null,
    warning: null,
    error: null,
    convertedAt: now().toISOString(),
    ...extra,
  });

  const withInfo = (item: OutputItem, info: MediaInfo): OutputItem => ({
    ...item,
    inputContainer: info.container,
    inputVideoCodec: info.video?.codec ?? null,
    inputAudioCodec: info.audio?.codec ?? null,
    inputWidth: info.video?.width ?? null,
    inputHeight: info.video?.height ?? null,
    inputDurationSeconds: info.durationSecs,
    inputBitrate: info.bitRate,
  });

  const fail = async (item: OutputItem, error: string) => {
    stats.failed += 1;
    log(`${item.url}: ${error}`);
    return (await deps.emit({ ...item, error }, null)).more;
  };

  const tmp = await mkdtemp(join(tmpdir(), "media-"));

  // Convert one downloaded file (serialized). Returns false to stop.
  const convertOne = async (
    job: Source,
    file: Downloaded,
  ): Promise<boolean> => {
    const started = clock();
    const outPath = join(tmp, `out-${job.index}.${EXTENSIONS[format]}`);
    let item = blank(job, { fileName: file.fileName, inputBytes: file.bytes });
    try {
      if (!deps.canCharge(cheapest, 1)) {
        stats.stopReason = "budget";
        return false;
      }
      const probed = await deps.media.probe(file.path);
      if (!probed.ok) return await fail(item, probed.error);
      const info = probed.info;
      item = withInfo(item, info);
      if (!audioOut && !info.video)
        return await fail(
          item,
          "The file has no video track (it is audio only). Choose mp3, m4a or wav as the output format.",
        );
      if (audioOut && !info.audio)
        return await fail(item, "The file has no audio track.");
      if (input.startSecs >= info.durationSecs)
        return await fail(
          item,
          `startSeconds (${input.startSecs}) is past the end of the file (${info.durationSecs} s).`,
        );
      const outSecs = round3(
        Math.min(
          info.durationSecs - input.startSecs,
          input.durationSecs ?? Infinity,
        ),
      );
      if (outSecs > input.maxDurationSecs)
        return await fail(
          item,
          `The output would be ${(outSecs / 60).toFixed(1)} min long, over the ${input.maxDurationSecs / 60} min limit (maxDurationMinutes). Raise the limit or trim with startSeconds/durationSeconds.`,
        );

      const warnings: string[] = [];
      const v = audioOut ? null : info.video!;
      const fit = v ? fitResolution(v.width, v.height, input.maxHeight) : null;
      const withAudio = info.audio !== null && (audioOut || !input.mute);
      if (!audioOut && !info.audio && !input.mute)
        warnings.push("The file has no audio track; the output is silent.");
      if (v && above1080p(v.width, v.height))
        warnings.push(
          `The input is ${v.width}x${v.height}, above 1080p: billed as 1080p minutes.`,
        );
      const event = eventFor(format, fit, v);
      const minutes = billedMinutes(outSecs);
      if (!deps.canCharge(event, minutes)) {
        stats.skippedBudget += 1;
        stats.stopReason = "budget";
        await fail(
          item,
          `Not converted: ${minutes} x ${event} is more than the remaining max charge per run.`,
        );
        // Shorter or smaller files may still fit.
        return deps.canCharge(cheapest, 1);
      }

      const rates =
        input.targetBytes && format !== "wav"
          ? targetBitrates(input.targetBytes, outSecs, !audioOut, withAudio)
          : null;
      if (input.targetBytes && format === "wav")
        warnings.push("WAV is uncompressed: targetMb is ignored.");
      if (rates?.warning) warnings.push(rates.warning);
      const plan: ConvertPlan = {
        format,
        startSecs: input.startSecs,
        durationSecs: input.durationSecs !== null ? outSecs : null,
        video:
          v && fit
            ? {
                stream: v.stream,
                width: fit.width,
                height: fit.height,
                scale: fit.scaled || v.anamorphic,
                fps: v.fps,
              }
            : null,
        audio: withAudio,
        audioChannels: info.audio?.channels ?? null,
        crf: input.crf,
        videoKbps: rates?.videoKbps ?? null,
        audioKbps: rates?.audioKbps ?? null,
        threads: deps.threads,
      };
      const timeoutMs = convertTimeoutMs(outSecs, v, deps.cpus);
      let res = await deps.media.convert(file.path, plan, outPath, timeoutMs);
      if (!res.ok) return await fail(item, res.error);
      // Target size missed by more than 5%: one more pass at a bitrate
      // scaled down by the miss (single-pass rate control drifts).
      if (rates && input.targetBytes && res.bytes > input.targetBytes * 1.05) {
        const k = (input.targetBytes / res.bytes) * 0.95;
        const lower = (n: number | null, min: number) =>
          n === null ? null : Math.max(min, Math.round(n * k));
        const retry: ConvertPlan = {
          ...plan,
          videoKbps: lower(plan.videoKbps, 50),
          audioKbps: audioOut ? lower(plan.audioKbps, 32) : plan.audioKbps,
        };
        if (
          retry.videoKbps !== plan.videoKbps ||
          retry.audioKbps !== plan.audioKbps
        ) {
          const again = await deps.media.convert(
            file.path,
            retry,
            outPath,
            timeoutMs,
          );
          if (!again.ok) return await fail(item, again.error);
          res = again;
        }
        if (res.bytes > input.targetBytes * 1.05 && !rates.warning)
          warnings.push(
            `The file is ${(res.bytes / 1024 / 1024).toFixed(1)} MB, over the ${targetMb} MB target.`,
          );
      }
      if (res.bytes > file.bytes && file.bytes > 0 && format !== "wav")
        warnings.push(
          "The output is larger than the input (it was already well compressed). Try a higher crf, a lower maxHeight or targetMb.",
        );

      // What FFprobe sees in the output (falls back to the plan).
      const out = await deps.media.probe(outPath);
      const outInfo = out.ok ? out.info : null;
      const key = outputKey(job.index, file.fileName, format);
      const outputUrl = await deps.saveFile(
        key,
        outPath,
        CONTENT_TYPES[format],
      );
      const done: OutputItem = {
        ...item,
        outputVideoCodec: plan.video
          ? (outInfo?.video?.codec ?? OUTPUT_CODECS[format].video)
          : null,
        outputAudioCodec: withAudio
          ? (outInfo?.audio?.codec ?? OUTPUT_CODECS[format].audio)
          : null,
        outputWidth: plan.video ? (outInfo?.video?.width ?? fit!.width) : null,
        outputHeight: plan.video
          ? (outInfo?.video?.height ?? fit!.height)
          : null,
        outputDurationSeconds: outInfo?.durationSecs ?? outSecs,
        outputBitrate:
          outInfo?.bitRate ?? Math.round((res.bytes * 8) / outSecs),
        outputBytes: res.bytes,
        savedPercent: savedPercent(file.bytes, res.bytes),
        crf: plan.video && !rates ? input.crf : null,
        outputKey: key,
        outputUrl,
        chargedEvent: event,
        chargedMinutes: minutes,
        processingSeconds: Math.round((clock() - started) / 10) / 100,
        warning: warnings.join(" ") || null,
      };
      const emitted = await deps.emit(done, { event, count: minutes });
      if (emitted.pushed) {
        stats.converted += 1;
        stats.minutes[event] = (stats.minutes[event] ?? 0) + minutes;
        stats.bytesIn += file.bytes;
        stats.bytesOut += res.bytes;
      } else {
        // Not paid for (budget used up): don't leave the file behind.
        await deps.deleteFile(key).catch(() => {});
      }
      if (!emitted.more) stats.stopReason = "budget";
      return emitted.more;
    } catch (e) {
      return await fail(item, `Conversion failed: ${errMsg(e)}`);
    } finally {
      await rm(file.path, { force: true }).catch(() => {});
      await rm(outPath, { force: true }).catch(() => {});
    }
  };

  // Download (in parallel) and return the step that finishes the job.
  const prepare = async (s: Source): Promise<() => Promise<boolean>> => {
    if (s.kind === "invalid") return () => fail(blank(s), s.error);
    if (!deps.canCharge(cheapest, 1))
      return async () => {
        stats.stopReason = "budget";
        return false;
      };
    const path = join(tmp, `in-${s.index}`);
    let file: Downloaded;
    try {
      if (s.kind === "sample") {
        const made = await deps.media.sample(path);
        if (!made.ok) throw new MediaError(made.error);
        file = {
          path,
          bytes: made.bytes,
          head: Buffer.from("\0\0\0\x20ftypisom"),
          contentType: "video/mp4",
          fileName: SAMPLE_NAME,
        };
      } else file = await deps.download(s, path);
    } catch (e) {
      await rm(path, { force: true }).catch(() => {});
      return () =>
        fail(
          blank(s),
          e instanceof MediaError ? e.message : `Download failed: ${errMsg(e)}`,
        );
    }
    const notMedia = notMediaError(file.head, file.contentType);
    if (notMedia) {
      await rm(path, { force: true }).catch(() => {});
      return () =>
        fail(
          blank(s, { fileName: file.fileName, inputBytes: file.bytes }),
          notMedia,
        );
    }
    return () => convertOne(s, file);
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
    if (left) log(`${left} file(s) not started (max charge reached).`);
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
  return stats;
}
