import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { notVideoError } from "./detect.js";
import { VideoError, type Downloaded } from "./download.js";
import type { MediaTools, VideoInfo } from "./ffmpeg.js";
import type {
  AudioFormat,
  FrameFormat,
  Mode,
  NormalizedInput,
  Source,
} from "./input.js";
import {
  costUsd,
  evenSample,
  EVENTS,
  fitWidth,
  formatUsd,
  intervalTimes,
  pickScenes,
  sheetLayout,
  startedMinutes,
  timecode,
  type Charges,
  type Prices,
  type Scene,
} from "./plan.js";

export type SourceType = "url" | "kv";

export interface FrameItem {
  /** 1-based frame number within the video. */
  index: number;
  timeSeconds: number;
  timecode: string;
  /** Scene mode: the cut's scene score (0-1); null in interval mode. */
  sceneScore: number | null;
  key: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
}

/** One dataset item per video: its frames and extras, or a failure. */
export interface OutputItem {
  /** Video URL, or "storeId/key" for a key-value store record. */
  url: string;
  sourceType: SourceType;
  fileName: string | null;
  bytes: number | null;
  mode: Mode;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  container: string | null;
  bitRate: number | null;
  rotation: number | null;
  hasAudio: boolean | null;
  audioSampleRate: number | null;
  audioChannels: number | null;
  /** Scene mode: scenes found (before the maxFrames cap). */
  sceneCount: number | null;
  frameFormat: FrameFormat;
  frameCount: number;
  frames: FrameItem[];
  frameUrls: string[];
  contactSheetUrl: string | null;
  gifUrl: string | null;
  audioUrl: string | null;
  audioFormat: AudioFormat | null;
  /** Events charged for this video, by event name. */
  charges: Charges;
  costUsd: number;
  processingSeconds: number | null;
  warning: string | null;
  error: string | null;
  processedAt: string;
}

export interface EmitResult {
  pushed: boolean;
  more: boolean;
}

export type Job = Extract<Source, { kind: "url" | "kv" }>;

export interface RunDeps {
  /** Saves the job's file to `path`. Throws VideoError for user-facing failures. */
  download: (job: Job, path: string) => Promise<Downloaded>;
  media: MediaTools;
  /** Event prices in USD (missing: free). */
  prices: Prices;
  /** USD the remaining max charge pays for (Infinity when unlimited). */
  budgetUsd: () => number;
  /**
   * Push one item, charging `charges` (empty for failures). `pushed: false`
   * when the budget was used up; `more: false` to stop.
   */
  emit: (item: OutputItem, charges: Charges) => Promise<EmitResult>;
  /** Stores an output file; returns its public URL. */
  saveFile: (key: string, path: string, contentType: string) => Promise<string>;
  /** Removes a stored file that was not paid for. */
  deleteFile: (key: string) => Promise<void>;
  log?: (msg: string) => void;
  now?: () => Date;
  clock?: () => number;
}

export interface RunStats {
  processed: number;
  failed: number;
  skippedBudget: number;
  frames: number;
  sceneMinutes: number;
  extras: number;
  videoSeconds: number;
  chargedUsd: number;
  stopReason: "done" | "budget";
}

/** Parallel downloads: the next video downloads while one is processed. */
export const DOWNLOAD_CONCURRENCY = 2;

export const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  opus: "audio/ogg",
};

const errMsg = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 500);

/** Key-value store key prefix for a video's outputs: video-0001. */
export const videoKey = (index: number) =>
  `video-${String(index + 1).padStart(4, "0")}`;

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

export async function runExtraction(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const clock = deps.clock ?? (() => performance.now());
  const serial = serializer();
  const stats: RunStats = {
    processed: 0,
    failed: 0,
    skippedBudget: 0,
    frames: 0,
    sceneMinutes: 0,
    extras: 0,
    videoSeconds: 0,
    chargedUsd: 0,
    stopReason: "done",
  };
  const price = (c: Charges) => costUsd(c, deps.prices);
  // Cheapest possible video: worth starting another one?
  const minCost = price({
    [EVENTS.video]: 1,
    ...(input.mode !== "none" ? { [EVENTS.frame]: 1 } : {}),
  });
  const canAfford = (usd: number) => deps.budgetUsd() + 1e-9 >= usd;

  const blank = (s: Source, extra: Partial<OutputItem> = {}): OutputItem => ({
    url: s.kind === "url" ? s.url : s.input,
    sourceType: s.kind === "kv" ? "kv" : "url",
    fileName: null,
    bytes: null,
    mode: input.mode,
    durationSeconds: null,
    width: null,
    height: null,
    fps: null,
    videoCodec: null,
    audioCodec: null,
    container: null,
    bitRate: null,
    rotation: null,
    hasAudio: null,
    audioSampleRate: null,
    audioChannels: null,
    sceneCount: null,
    frameFormat: input.frameFormat,
    frameCount: 0,
    frames: [],
    frameUrls: [],
    contactSheetUrl: null,
    gifUrl: null,
    audioUrl: null,
    audioFormat: input.audioFormat,
    charges: {},
    costUsd: 0,
    processingSeconds: null,
    warning: null,
    error: null,
    processedAt: now().toISOString(),
    ...extra,
  });

  const fail = async (item: OutputItem, error: string) => {
    stats.failed += 1;
    log(`${item.url}: ${error}`);
    return (await deps.emit({ ...item, error }, {})).more;
  };

  const withInfo = (item: OutputItem, info: VideoInfo): OutputItem => ({
    ...item,
    durationSeconds: info.durationSecs,
    width: info.width,
    height: info.height,
    fps: info.fps,
    videoCodec: info.videoCodec,
    audioCodec: info.audioCodec,
    container: info.container,
    bitRate: info.bitRate,
    rotation: info.rotation,
    hasAudio: info.audioCodec !== null,
    audioSampleRate: info.audioSampleRate,
    audioChannels: info.audioChannels,
  });

  const tmp = await mkdtemp(join(tmpdir(), "frames-"));

  // Process one downloaded video (serialized). Returns false to stop.
  const processOne = async (job: Job, file: Downloaded): Promise<boolean> => {
    const started = clock();
    const work = join(tmp, `work-${job.index}`);
    const prefix = videoKey(job.index);
    const saved: string[] = [];
    const warnings: string[] = [];
    let item = blank(job, { fileName: file.fileName, bytes: file.bytes });
    try {
      if (!canAfford(minCost)) {
        stats.stopReason = "budget";
        return false;
      }
      const probed = await deps.media.probe(file.path);
      if (!probed.ok) return await fail(item, probed.error);
      const info = probed.info;
      item = withInfo(item, info);
      if (info.durationSecs > input.maxDurationSecs)
        return await fail(
          item,
          `The video is ${(info.durationSecs / 60).toFixed(1)} min long, over the ${input.maxDurationSecs / 60} min limit (maxDurationMinutes).`,
        );

      // Fixed costs, known before any work.
      const sheet = input.contactSheetColumns > 0;
      const gif = input.gif;
      const wantAudio = input.audioFormat !== null;
      if (wantAudio && !info.audioCodec)
        warnings.push("The video has no audio track; no audio file was made.");
      if (gif && gif.startSecs >= info.durationSecs)
        warnings.push(
          `The GIF start (${gif.startSecs} s) is past the end of the video; no GIF was made.`,
        );
      const doGif = gif !== null && gif.startSecs < info.durationSecs;
      const doAudio = wantAudio && info.audioCodec !== null;
      const sceneMinutes =
        input.mode === "scene" ? startedMinutes(info.durationSecs) : 0;
      const fixed: Charges = {
        [EVENTS.video]: 1,
        ...(sceneMinutes ? { [EVENTS.sceneMinute]: sceneMinutes } : {}),
        ...(doGif || doAudio
          ? { [EVENTS.extra]: Number(doGif) + Number(doAudio) }
          : {}),
      };
      const framePrice = price({ [EVENTS.frame]: 1 });

      // Interval frames are known up front; scene frames after detection.
      let times: number[] = [];
      let scenes: Scene[] | null = null;
      if (input.mode === "interval") {
        const plan = intervalTimes(
          info.durationSecs,
          input.intervalSecs,
          input.frameCount,
          input.maxFrames,
        );
        times = plan.times;
        if (plan.warning) warnings.push(plan.warning);
      }
      const minFrames = input.mode === "scene" ? 1 : times.length;
      const needed = {
        ...fixed,
        ...(minFrames ? { [EVENTS.frame]: minFrames + (sheet ? 1 : 0) } : {}),
      };
      const budget = deps.budgetUsd();
      if (!canAfford(price(needed))) {
        stats.skippedBudget += 1;
        stats.stopReason = "budget";
        await fail(
          item,
          `Not processed: this video costs ${input.mode === "scene" ? "at least " : ""}${formatUsd(price(needed))}, more than the remaining max charge per run (${formatUsd(budget)}).`,
        );
        // A shorter video, or one with fewer frames, may still fit.
        return canAfford(minCost);
      }

      if (input.mode === "scene") {
        const detected = await deps.media.scenes(
          file.path,
          info,
          input.sceneThreshold,
        );
        if (!detected.ok) return await fail(item, detected.error);
        // Frames the rest of the budget pays for.
        const affordable = framePrice
          ? Math.floor(
              (deps.budgetUsd() - price(fixed) + 1e-9) / framePrice -
                (sheet ? 1 : 0),
            )
          : Infinity;
        const max = Math.max(1, Math.min(input.maxFrames, affordable));
        const picked = pickScenes(detected.cuts, input.minSceneSecs, max);
        scenes = picked.scenes;
        times = scenes.map((s) => s.time);
        item.sceneCount = picked.detected;
        if (picked.warning)
          warnings.push(
            max < input.maxFrames
              ? `${picked.detected} scenes found; kept the ${max} strongest cuts that the max charge per run pays for.`
              : picked.warning,
          );
      }

      await mkdir(work, { recursive: true });
      const fit = fitWidth(info.width, info.height, input.maxWidth);
      const resized =
        fit.scaled ||
        (info.rotation % 180 === 0
          ? info.width !== info.codedWidth
          : info.height !== info.codedWidth);
      const frameOpts = {
        format: input.frameFormat,
        quality: input.frameQuality,
        size: resized ? { width: fit.width, height: fit.height } : null,
      };
      const ext = input.frameFormat;

      // Frames.
      const frames: FrameItem[] = [];
      const framePaths: string[] = [];
      for (const [i, t] of times.entries()) {
        const out = join(work, `frame-${i}.${ext}`);
        let time = t;
        let res = await deps.media.frame(file.path, info, t, out, frameOpts);
        // Seeking to the very end may find no frame: try a little earlier.
        if (!res.ok && t > info.durationSecs - 2 && t >= 1) {
          time = Math.round((t - 1) * 1000) / 1000;
          res = await deps.media.frame(file.path, info, time, out, frameOpts);
        }
        if (!res.ok) {
          warnings.push(`No frame at ${timecode(t)} (${res.error})`);
          continue;
        }
        const n = frames.length + 1;
        const key = `${prefix}-frame-${String(n).padStart(4, "0")}.${ext}`;
        const url = await deps.saveFile(key, out, CONTENT_TYPES[ext]!);
        saved.push(key);
        framePaths.push(out);
        frames.push({
          index: n,
          timeSeconds: time,
          timecode: timecode(time),
          sceneScore: scenes ? (scenes[i]?.score ?? null) : null,
          key,
          url,
          width: fit.width,
          height: fit.height,
          bytes: res.bytes,
        });
      }
      if (times.length && !frames.length)
        return await fail(
          item,
          `No frames could be extracted. ${warnings.at(-1) ?? ""}`.trim(),
        );

      // Contact sheet (one frame event).
      let contactSheetUrl: string | null = null;
      if (sheet && frames.length) {
        const layout = sheetLayout(
          frames.length,
          input.contactSheetColumns,
          fit.width,
          fit.height,
        );
        if (layout.tiles < frames.length)
          warnings.push(
            `The contact sheet shows ${layout.tiles} of ${frames.length} frames (at most ${layout.rows} rows).`,
          );
        const out = join(work, `sheet.${ext}`);
        const res = await deps.media.contactSheet(
          evenSample(framePaths, layout.tiles),
          out,
          layout,
          frameOpts,
        );
        if (res.ok) {
          const key = `${prefix}-contact-sheet.${ext}`;
          contactSheetUrl = await deps.saveFile(key, out, CONTENT_TYPES[ext]!);
          saved.push(key);
        } else warnings.push(res.error);
      }

      // GIF clip and audio track (one extra event each).
      let gifUrl: string | null = null;
      if (doGif) {
        const size = fitWidth(info.width, info.height, gif.width);
        const out = join(work, "clip.gif");
        const res = await deps.media.gif(file.path, info, gif, size, out);
        if (res.ok) {
          const key = `${prefix}-clip.gif`;
          gifUrl = await deps.saveFile(key, out, CONTENT_TYPES.gif!);
          saved.push(key);
        } else warnings.push(res.error);
      }
      let audioUrl: string | null = null;
      if (doAudio) {
        const fmt = input.audioFormat!;
        const out = join(work, `audio.${fmt}`);
        const res = await deps.media.audio(file.path, info, fmt, out);
        if (res.ok) {
          const key = `${prefix}-audio.${fmt}`;
          audioUrl = await deps.saveFile(key, out, CONTENT_TYPES[fmt]!);
          saved.push(key);
        } else warnings.push(res.error);
      }

      const extras = Number(gifUrl !== null) + Number(audioUrl !== null);
      const frameEvents = frames.length + Number(contactSheetUrl !== null);
      const charges: Charges = {
        [EVENTS.video]: 1,
        ...(frameEvents ? { [EVENTS.frame]: frameEvents } : {}),
        ...(sceneMinutes ? { [EVENTS.sceneMinute]: sceneMinutes } : {}),
        ...(extras ? { [EVENTS.extra]: extras } : {}),
      };
      const cost = price(charges);
      const done: OutputItem = {
        ...item,
        frameCount: frames.length,
        frames,
        frameUrls: frames.map((f) => f.url),
        contactSheetUrl,
        gifUrl,
        audioUrl,
        charges,
        costUsd: cost,
        processingSeconds: Math.round((clock() - started) / 10) / 100,
        warning: warnings.join(" ") || null,
      };
      // Checked before the work; only a concurrent charge could get here.
      if (!canAfford(cost)) {
        stats.skippedBudget += 1;
        stats.stopReason = "budget";
        await fail(
          { ...item, warning: done.warning },
          `Not delivered: this video costs ${formatUsd(cost)}, more than the remaining max charge per run.`,
        );
        return false;
      }
      const emitted = await deps.emit(done, charges);
      if (emitted.pushed) {
        saved.length = 0; // Paid for: keep the files.
        stats.processed += 1;
        stats.frames += frameEvents;
        stats.sceneMinutes += sceneMinutes;
        stats.extras += extras;
        stats.videoSeconds += info.durationSecs;
        stats.chargedUsd = Math.round((stats.chargedUsd + cost) * 1e6) / 1e6;
      }
      if (!emitted.more) stats.stopReason = "budget";
      return emitted.more;
    } catch (e) {
      return await fail(item, `Processing failed: ${errMsg(e)}`);
    } finally {
      // Files of a failed or unpaid video are not left behind.
      for (const key of saved) await deps.deleteFile(key).catch(() => {});
      await rm(file.path, { force: true }).catch(() => {});
      await rm(work, { recursive: true, force: true }).catch(() => {});
    }
  };

  const one = async (s: Source): Promise<boolean> => {
    if (s.kind === "invalid") return fail(blank(s), s.error);
    if (!canAfford(minCost)) {
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
        e instanceof VideoError ? e.message : `Download failed: ${errMsg(e)}`,
      );
    }
    const notVideo = notVideoError(file.head, file.contentType);
    if (notVideo) {
      await rm(path, { force: true }).catch(() => {});
      return fail(
        blank(s, { fileName: file.fileName, bytes: file.bytes }),
        notVideo,
      );
    }
    // Downloads run in parallel; processing and charging one at a time.
    return serial(() => processOne(s, file));
  };

  try {
    const left = await forEachLimit(input.sources, DOWNLOAD_CONCURRENCY, one);
    if (left) log(`${left} video(s) not started (max charge reached).`);
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
  return stats;
}
