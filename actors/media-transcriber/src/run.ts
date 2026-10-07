import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  segmentsToText,
  toSrt,
  toVtt,
  wordCount,
  type Segment,
} from "./captions.js";
import { chunkSegments } from "./chunk.js";
import { notMediaError } from "./detect.js";
import { MediaError, type Downloaded } from "./download.js";
import { parseFeed, type Episode } from "./feed.js";
import type { Model, NormalizedInput, OutputFormat, Source } from "./input.js";
import type { Seen } from "./state.js";
import type { Transcribe, TranscribeResult } from "./worker.js";

export type SourceType = "url" | "kv" | "rss";

/** One dataset item: a whole transcript, one chunk of it, or a failure. */
export interface OutputItem {
  /** Media URL, "storeId/key" for a key-value store record, or the feed URL of a failed feed. */
  url: string;
  sourceType: SourceType;
  feedUrl: string | null;
  podcastTitle: string | null;
  /** Episode title, or the file name. */
  title: string | null;
  episodeGuid: string | null;
  publishedAt: string | null;
  fileName: string | null;
  bytes: number | null;
  model: Model;
  /** Detected (or given) language code. */
  language: string | null;
  languageProbability: number | null;
  durationSeconds: number | null;
  billedMinutes: number;
  outputFormat: OutputFormat;
  /** The whole transcript, or one chunk's text; null on failure. */
  text: string | null;
  segments: Segment[] | null;
  segmentCount: number | null;
  wordCount: number | null;
  chunkIndex: number | null;
  chunkCount: number | null;
  startTime: number | null;
  endTime: number | null;
  srtUrl: string | null;
  vttUrl: string | null;
  warning: string | null;
  error: string | null;
  transcribedAt: string;
}

export interface EmitResult {
  pushed: boolean;
  more: boolean;
}

/** A media file to transcribe. */
export type Job =
  | (Extract<Source, { kind: "url" | "kv" }> & { episode?: undefined })
  | {
      index: number;
      kind: "episode";
      input: string;
      url: string;
      episode: Episode & { feedUrl: string; podcastTitle: string | null };
    };

export interface RunDeps {
  fetchFeed: (url: string) => Promise<string>;
  /** Saves the job's file to `path`. Throws MediaError for user-facing failures. */
  download: (job: Job, path: string) => Promise<Downloaded>;
  transcribe: Transcribe;
  /** Minutes the remaining budget pays for (Infinity when unlimited). */
  budgetMinutes: () => number;
  /**
   * Push one media's items, charging `minutes` (0 for failures). `pushed:
   * false` when the budget was used up; `more: false` to stop.
   */
  emit: (items: OutputItem[], minutes: number) => Promise<EmitResult>;
  /** Stores a caption file; returns its public URL. */
  saveFile: (key: string, text: string, contentType: string) => Promise<string>;
  /** onlyNewEpisodes: episodes returned by earlier runs. */
  seen?: Seen;
  saveState?: () => Promise<void>;
  threads: number;
  log?: (msg: string) => void;
  now?: () => Date;
}

export interface RunStats {
  transcribed: number;
  failed: number;
  feeds: number;
  episodes: number;
  skippedSeen: number;
  skippedBudget: number;
  billedMinutes: number;
  audioSeconds: number;
  items: number;
  stopReason: "done" | "budget";
}

/** Parallel downloads: the next file downloads while one is transcribed. */
export const DOWNLOAD_CONCURRENCY = 2;

const errMsg = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 500);

export const billableMinutes = (seconds: number) =>
  Math.max(1, Math.ceil(seconds / 60));

/** Backstop per file (real speed is ~0.1x real time for base, ~0.25x small). */
export const transcribeTimeoutMs = (maxSeconds: number, model: Model) =>
  Math.round(300 + maxSeconds * (model === "small" ? 1.5 : 0.75)) * 1000;

export const seenId = (feedUrl: string, guid: string) => `${feedUrl}|${guid}`;

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

export async function runTranscriptions(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const serial = serializer();
  const stats: RunStats = {
    transcribed: 0,
    failed: 0,
    feeds: 0,
    episodes: 0,
    skippedSeen: 0,
    skippedBudget: 0,
    billedMinutes: 0,
    audioSeconds: 0,
    items: 0,
    stopReason: "done",
  };

  const blank = (
    url: string,
    sourceType: SourceType,
    extra: Partial<OutputItem> = {},
  ): OutputItem => ({
    url,
    sourceType,
    feedUrl: null,
    podcastTitle: null,
    title: null,
    episodeGuid: null,
    publishedAt: null,
    fileName: null,
    bytes: null,
    model: input.model,
    language: null,
    languageProbability: null,
    durationSeconds: null,
    billedMinutes: 0,
    outputFormat: input.outputFormat,
    text: null,
    segments: null,
    segmentCount: null,
    wordCount: null,
    chunkIndex: null,
    chunkCount: null,
    startTime: null,
    endTime: null,
    srtUrl: null,
    vttUrl: null,
    warning: null,
    error: null,
    transcribedAt: now().toISOString(),
    ...extra,
  });

  const jobBase = (job: Job): OutputItem => {
    if (job.kind === "url") return blank(job.url, "url");
    if (job.kind === "kv") return blank(job.input, "kv");
    const e = job.episode;
    return blank(job.url, "rss", {
      feedUrl: e.feedUrl,
      podcastTitle: e.podcastTitle,
      title: e.title,
      episodeGuid: e.guid,
      publishedAt: e.publishedAt,
    });
  };

  const fail = async (item: OutputItem, error: string) => {
    stats.failed += 1;
    log(`${item.url}: ${error}`);
    const res = await deps.emit([{ ...item, error }], 0);
    if (res.pushed) stats.items += 1;
    return res.more;
  };

  // 1. Expand feeds into episode jobs; report invalid inputs.
  const jobs: Job[] = [];
  for (const s of input.sources) {
    if (s.kind === "invalid") {
      if (!(await fail(blank(s.input, "url"), s.error))) return stats;
      continue;
    }
    if (s.kind !== "feed") {
      jobs.push(s);
      continue;
    }
    stats.feeds += 1;
    let feed;
    try {
      feed = parseFeed(await deps.fetchFeed(s.url), s.url);
    } catch (e) {
      const msg =
        e instanceof MediaError ? e.message : `Invalid feed: ${errMsg(e)}`;
      if (!(await fail(blank(s.url, "rss", { feedUrl: s.url }), msg)))
        return stats;
      continue;
    }
    if (!feed.episodes.length) {
      if (
        !(await fail(
          blank(s.url, "rss", { feedUrl: s.url, podcastTitle: feed.title }),
          "The feed has no episodes with an audio or video file.",
        ))
      )
        return stats;
      continue;
    }
    // The newest maxEpisodes; onlyNewEpisodes drops those done before.
    const latest = feed.episodes.slice(0, input.maxEpisodes);
    const fresh = latest.filter((e) => !deps.seen?.has(seenId(s.url, e.guid)));
    stats.skippedSeen += latest.length - fresh.length;
    log(
      `Feed ${s.url}: ${feed.episodes.length} episode(s), transcribing ${fresh.length}` +
        (latest.length > fresh.length
          ? ` (${latest.length - fresh.length} done in earlier runs)`
          : "") +
        ".",
    );
    for (const e of fresh)
      jobs.push({
        index: 0,
        kind: "episode",
        input: e.url,
        url: e.url,
        episode: { ...e, feedUrl: s.url, podcastTitle: feed.title },
      });
  }
  jobs.forEach((j, i) => (j.index = i));
  stats.episodes = jobs.filter((j) => j.kind === "episode").length;

  const tmp = await mkdtemp(join(tmpdir(), "media-"));

  // 2. Transcribe one file (serialized). Returns false to stop the run.
  const transcribeOne = async (job: Job, file: Downloaded) => {
    const meta: Partial<OutputItem> = {
      fileName: file.fileName,
      bytes: file.bytes,
    };
    const item0 = {
      ...jobBase(job),
      ...meta,
      title: jobBase(job).title ?? file.fileName,
    };
    const budget = deps.budgetMinutes();
    if (budget < 1) {
      stats.stopReason = "budget";
      return false;
    }
    let res: TranscribeResult;
    try {
      res = await deps.transcribe(
        {
          path: file.path,
          model: input.model,
          language: input.language,
          threads: deps.threads,
          maxSeconds: input.maxDurationSecs,
          budgetMinutes: Number.isFinite(budget) ? Math.floor(budget) : null,
        },
        transcribeTimeoutMs(input.maxDurationSecs, input.model),
      );
    } catch (e) {
      res = {
        ok: false,
        error: `Transcription failed: ${errMsg(e)}`,
        code: "internal",
      };
    } finally {
      await rm(file.path, { force: true }).catch(() => {});
    }
    if (!res.ok) {
      const duration =
        res.duration != null ? Math.round(res.duration * 1000) / 1000 : null;
      if (res.code === "budget") {
        stats.skippedBudget += 1;
        stats.stopReason = "budget";
      }
      return fail({ ...item0, durationSeconds: duration }, res.error);
    }

    const duration = Math.round(res.duration * 1000) / 1000;
    const done = {
      ...item0,
      language: res.language,
      languageProbability: res.languageProbability,
      durationSeconds: duration,
    };
    const text = segmentsToText(res.segments);
    if (!text)
      return fail(
        { ...done, warning: res.warnings.join(" ") || null },
        "No speech detected.",
      );

    const minutes = billableMinutes(res.duration);
    const key = `transcript-${String(job.index + 1).padStart(4, "0")}`;
    const [srtUrl, vttUrl] = await Promise.all([
      deps.saveFile(
        `${key}.srt`,
        toSrt(res.segments),
        "application/x-subrip; charset=utf-8",
      ),
      deps.saveFile(
        `${key}.vtt`,
        toVtt(res.segments),
        "text/vtt; charset=utf-8",
      ),
    ]);
    const common: OutputItem = {
      ...done,
      billedMinutes: minutes,
      segmentCount: res.segments.length,
      srtUrl,
      vttUrl,
      warning: res.warnings.join(" ") || null,
    };
    let items: OutputItem[];
    if (input.outputFormat === "chunks") {
      const chunks = chunkSegments(res.segments, {
        size: input.chunkSize,
        overlap: input.chunkOverlap,
      });
      // The whole media is billed once, on its first chunk.
      items = chunks.map((c, i) => ({
        ...common,
        billedMinutes: i === 0 ? minutes : 0,
        text: c.text,
        wordCount: wordCount(c.text),
        chunkIndex: i,
        chunkCount: chunks.length,
        startTime: c.start,
        endTime: c.end,
      }));
    } else {
      items = [
        {
          ...common,
          text,
          segments: res.segments,
          wordCount: wordCount(text),
        },
      ];
    }

    const emitted = await deps.emit(items, minutes);
    if (emitted.pushed) {
      stats.transcribed += 1;
      stats.billedMinutes += minutes;
      stats.audioSeconds += res.duration;
      stats.items += items.length;
      if (job.kind === "episode" && deps.seen) {
        deps.seen.add(seenId(job.episode.feedUrl, job.episode.guid));
        await deps.saveState?.();
      }
    }
    if (!emitted.more) stats.stopReason = "budget";
    return emitted.more;
  };

  const one = async (job: Job): Promise<boolean> => {
    const declared = job.episode?.durationSecs;
    if (declared && declared > input.maxDurationSecs * 1.1)
      return fail(
        { ...jobBase(job), durationSeconds: declared },
        `The episode is ${(declared / 60).toFixed(1)} min long (per the feed), over the ${input.maxDurationSecs / 60} min limit (maxDurationMinutes).`,
      );
    if (deps.budgetMinutes() < 1) {
      stats.stopReason = "budget";
      return false;
    }
    const path = join(tmp, `media-${job.index}`);
    let file: Downloaded;
    try {
      file = await deps.download(job, path);
    } catch (e) {
      await rm(path, { force: true }).catch(() => {});
      return fail(
        jobBase(job),
        e instanceof MediaError ? e.message : `Download failed: ${errMsg(e)}`,
      );
    }
    const notMedia = notMediaError(file.head, file.contentType);
    if (notMedia) {
      await rm(path, { force: true }).catch(() => {});
      return fail(
        { ...jobBase(job), fileName: file.fileName, bytes: file.bytes },
        notMedia,
      );
    }
    // Downloads run in parallel; transcription and charging one at a time.
    return serial(() => transcribeOne(job, file));
  };

  try {
    const left = await forEachLimit(jobs, DOWNLOAD_CONCURRENCY, one);
    if (left) log(`${left} file(s) not started (max charge reached).`);
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
  return stats;
}
