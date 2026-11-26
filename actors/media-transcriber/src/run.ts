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
import type { DatasetOrigin } from "./dataset.js";
import { notMediaError } from "./detect.js";
import {
  MediaError,
  RobotsBlockedError,
  type Downloaded,
  type TextDocument,
} from "./download.js";
import { filterEpisodes, parseFeed, type Episode } from "./feed.js";
import type {
  Model,
  NormalizedInput,
  OutputFormat,
  Source,
  Task,
} from "./input.js";
import type { Seen } from "./state.js";
import {
  parsePublishedTranscript,
  type ParsedTranscript,
} from "./transcript.js";
import type { Transcribe, TranscribeResult } from "./worker.js";

export type SourceType = "url" | "kv" | "rss";

/**
 * transcribed: success. failed: an error (free). skipped_robots: robots.txt
 * disallows the feed, file or a redirect hop, names a Claude crawler, or
 * can't be verified (free). no_published_transcript: publishedOnly and the
 * episode has no usable published transcript (free).
 */
export type ItemStatus =
  "transcribed" | "failed" | "skipped_robots" | "no_published_transcript";

export type TranscriptSource = "published" | "whisper";

/** One dataset item: a whole transcript, one chunk of it, or a failure. */
export interface OutputItem {
  /** Media URL, "storeId/key" for a key-value store record, or the feed URL of a failed feed. */
  url: string;
  status: ItemStatus;
  /** published: the podcast's own <podcast:transcript>; whisper: transcribed here. */
  transcriptSource: TranscriptSource | null;
  publishedTranscriptUrl: string | null;
  sourceType: SourceType;
  /** Dataset the URL was read from; null for pasted datasetItems or none. */
  sourceDatasetId: string | null;
  /** 0-based row of datasetId or datasetItems; null when not from one. */
  sourceItemIndex: number | null;
  feedUrl: string | null;
  podcastTitle: string | null;
  /** Episode title, or the file name. */
  title: string | null;
  episodeGuid: string | null;
  publishedAt: string | null;
  fileName: string | null;
  bytes: number | null;
  model: Model;
  /** transcribe, or translate (Whisper wrote English); null on failure. */
  task: Task | null;
  /** The vocabulary Whisper was prompted with; null for none. */
  vocabularyUsed: string | null;
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
      episode: Episode & {
        feedUrl: string;
        podcastTitle: string | null;
        feedLanguage: string | null;
      };
    };

export interface RunDeps {
  fetchFeed: (url: string) => Promise<string>;
  /** Fetches a published transcript (robots-checked). */
  fetchTranscript?: (url: string) => Promise<TextDocument>;
  /** Saves the job's file to `path`. Throws MediaError for user-facing failures. */
  download: (job: Job, path: string) => Promise<Downloaded>;
  transcribe: Transcribe;
  /** Minutes the remaining budget pays for (Infinity when unlimited). */
  budgetMinutes: () => number;
  /**
   * Push one media's items, charging `minutes` (0 for failures), or one
   * published-transcript event when `published`. `pushed: false` when the
   * budget was used up; `more: false` to stop.
   */
  emit: (
    items: OutputItem[],
    minutes: number,
    published?: boolean,
  ) => Promise<EmitResult>;
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
  /** Whisper and published transcripts. */
  transcribed: number;
  /** Episodes served from a published transcript. */
  published: number;
  failed: number;
  skippedRobots: number;
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

/** Turns 0..n-1 in order: `wait(i)` resolves once `done(i - 1)` is called. */
function turnstile(n: number) {
  const done: (() => void)[] = [];
  const turns = Array.from(
    { length: n },
    () => new Promise<void>((r) => done.push(r)),
  );
  return {
    wait: (i: number) => (i === 0 ? Promise.resolve() : turns[i - 1]!),
    done: (i: number) => done[i]!(),
  };
}

export async function runTranscriptions(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const stats: RunStats = {
    transcribed: 0,
    published: 0,
    failed: 0,
    skippedRobots: 0,
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
    status: "failed",
    transcriptSource: null,
    publishedTranscriptUrl: null,
    sourceType,
    sourceDatasetId: null,
    sourceItemIndex: null,
    feedUrl: null,
    podcastTitle: null,
    title: null,
    episodeGuid: null,
    publishedAt: null,
    fileName: null,
    bytes: null,
    model: input.model,
    task: null,
    vocabularyUsed: null,
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

  const fromDataset = (s: { origin?: DatasetOrigin }) =>
    s.origin
      ? {
          sourceDatasetId: s.origin.datasetId,
          sourceItemIndex: s.origin.itemIndex,
        }
      : {};

  const jobBase = (job: Job): OutputItem => {
    if (job.kind === "url") return blank(job.url, "url", fromDataset(job));
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

  const fail = async (
    item: OutputItem,
    error: string,
    status: Exclude<ItemStatus, "transcribed"> = "failed",
  ) => {
    if (status === "skipped_robots") stats.skippedRobots += 1;
    else stats.failed += 1;
    log(`${item.url}: ${error}`);
    const res = await deps.emit([{ ...item, status, error }], 0);
    if (res.pushed) stats.items += 1;
    return res.more;
  };
  /** A caught download/feed error: robots skips keep their own status. */
  const failWith = (item: OutputItem, e: unknown, prefix: string) =>
    e instanceof RobotsBlockedError
      ? fail(item, e.message, "skipped_robots")
      : fail(
          item,
          e instanceof MediaError ? e.message : `${prefix}: ${errMsg(e)}`,
        );

  // 1. Expand feeds into episode jobs; report invalid inputs.
  const jobs: Job[] = [];
  for (const s of input.sources) {
    if (s.kind === "invalid") {
      if (!(await fail(blank(s.input, "url", fromDataset(s)), s.error)))
        return stats;
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
      if (
        !(await failWith(
          blank(s.url, "rss", { feedUrl: s.url }),
          e,
          "Invalid feed",
        ))
      )
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
    const matching = filterEpisodes(feed.episodes, input);
    if (!matching.length) {
      if (
        !(await fail(
          blank(s.url, "rss", { feedUrl: s.url, podcastTitle: feed.title }),
          `None of the feed's ${feed.episodes.length} episode(s) match publishedAfter, titleContains and titleExcludes.`,
        ))
      )
        return stats;
      continue;
    }
    // The newest maxEpisodes; onlyNewEpisodes drops those done before.
    const latest = matching.slice(0, input.maxEpisodes);
    const fresh = latest.filter((e) => !deps.seen?.has(seenId(s.url, e.guid)));
    stats.skippedSeen += latest.length - fresh.length;
    log(
      `Feed ${s.url}: ${feed.episodes.length} episode(s)` +
        (matching.length < feed.episodes.length
          ? ` (${matching.length} matching the filters)`
          : "") +
        `, transcribing ${fresh.length}` +
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
        episode: {
          ...e,
          feedUrl: s.url,
          podcastTitle: feed.title,
          feedLanguage: feed.language,
        },
      });
  }
  jobs.forEach((j, i) => (j.index = i));
  const turns = turnstile(jobs.length);
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
          wordTimestamps: input.wordTimestamps,
          task: input.task,
          vocabulary: input.vocabulary,
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
    const warning = [publishedNotes.get(job.index), ...res.warnings].filter(
      Boolean,
    );
    return emitTranscript(
      job,
      {
        ...done,
        transcriptSource: "whisper",
        task: input.task,
        vocabularyUsed: input.vocabulary,
        billedMinutes: minutes,
        warning: warning.join(" ") || null,
      },
      { segments: res.segments, timed: true },
      minutes,
      res.duration,
    );
  };

  /** Saves captions, builds the items and charges for one transcript. */
  const emitTranscript = async (
    job: Job,
    base: OutputItem,
    parsed: ParsedTranscript,
    /** Billed minutes (whisper), or 0 for one published-transcript event. */
    minutes: number,
    audioSeconds: number,
  ): Promise<boolean> => {
    const { segments, timed } = parsed;
    const published = base.transcriptSource === "published";
    const text = timed
      ? segmentsToText(segments)
      : segments.map((s) => s.text).join("\n\n");
    let srtUrl: string | null = null;
    let vttUrl: string | null = null;
    if (timed) {
      const key = `transcript-${String(job.index + 1).padStart(4, "0")}`;
      [srtUrl, vttUrl] = await Promise.all([
        deps.saveFile(
          `${key}.srt`,
          toSrt(segments),
          "application/x-subrip; charset=utf-8",
        ),
        deps.saveFile(`${key}.vtt`, toVtt(segments), "text/vtt; charset=utf-8"),
      ]);
    }
    const common: OutputItem = {
      ...base,
      status: "transcribed",
      segmentCount: timed ? segments.length : null,
      srtUrl,
      vttUrl,
    };
    let items: OutputItem[];
    if (input.outputFormat === "chunks") {
      const chunks = chunkSegments(segments, {
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
        startTime: timed ? c.start : null,
        endTime: timed ? c.end : null,
      }));
    } else {
      items = [
        {
          ...common,
          text,
          segments: timed ? segments : null,
          wordCount: wordCount(text),
        },
      ];
    }

    const emitted = await deps.emit(items, minutes, published || undefined);
    if (emitted.pushed) {
      stats.transcribed += 1;
      if (published) stats.published += 1;
      stats.billedMinutes += minutes;
      stats.audioSeconds += audioSeconds;
      stats.items += items.length;
      if (job.kind === "episode" && deps.seen) {
        deps.seen.add(seenId(job.episode.feedUrl, job.episode.guid));
        await deps.saveState?.();
      }
    }
    if (!emitted.more) stats.stopReason = "budget";
    return emitted.more;
  };

  /**
   * Fetches and parses the episode's published transcripts, best first.
   * Returns the transcript, or why none could be used.
   */
  const fetchPublished = async (
    job: Extract<Job, { kind: "episode" }>,
  ): Promise<
    | {
        ok: true;
        url: string;
        language: string | null;
        parsed: ParsedTranscript;
      }
    | { ok: false; reason: string; robots: boolean }
  > => {
    const reasons: string[] = [];
    let robots = 0;
    for (const t of job.episode.transcripts) {
      try {
        if (!deps.fetchTranscript) throw new Error("not available");
        const doc = await deps.fetchTranscript(t.url);
        return {
          ok: true,
          url: t.url,
          language: t.language,
          parsed: parsePublishedTranscript(doc.text, t.kind),
        };
      } catch (e) {
        if (e instanceof RobotsBlockedError) robots += 1;
        reasons.push(`${t.kind}: ${errMsg(e)}`);
      }
    }
    return {
      ok: false,
      // Only when every link was refused by robots.txt.
      robots: robots > 0 && robots === reasons.length,
      reason: reasons.length
        ? `Published transcript unavailable (${reasons.join("; ")}).`
        : "The episode has no published transcript (<podcast:transcript>).",
    };
  };

  /** Why the published transcript wasn't used, per job (a warning). */
  const publishedNotes = new Map<number, string>();

  const oneJob = async (job: Job): Promise<boolean> => {
    // Published transcript fast path: no download, no Whisper.
    if (job.kind === "episode" && input.preferPublishedTranscripts) {
      let pub = await fetchPublished(job);
      // translateToEnglish: only an English published transcript will do.
      const pubLanguage = pub.ok
        ? (pub.language ?? job.episode.feedLanguage)
        : null;
      if (pub.ok && input.task === "translate" && pubLanguage !== "en")
        pub = {
          ok: false,
          robots: false,
          reason: `The published transcript is ${pubLanguage ? `in "${pubLanguage}"` : "in an unknown language"}, not English (translateToEnglish).`,
        };
      if (pub.ok) {
        await turns.wait(job.index);
        const { segments, timed } = pub.parsed;
        const end = timed
          ? segments.reduce((m, s) => Math.max(m, s.end), 0)
          : 0;
        const duration = job.episode.durationSecs ?? (end > 0 ? end : null);
        return emitTranscript(
          job,
          {
            ...jobBase(job),
            transcriptSource: "published",
            publishedTranscriptUrl: pub.url,
            task: "transcribe",
            language: pub.language ?? job.episode.feedLanguage,
            durationSeconds: duration,
            warning: input.wordTimestamps
              ? "Published transcripts have no word timestamps; set preferPublishedTranscripts to false to get them from Whisper."
              : null,
          },
          pub.parsed,
          0,
          0,
        );
      }
      if (job.episode.transcripts.length) {
        publishedNotes.set(job.index, pub.reason);
        log(`${job.url}: ${pub.reason}`);
      }
      if (input.publishedOnly) {
        await turns.wait(job.index);
        return fail(
          jobBase(job),
          pub.reason,
          pub.robots ? "skipped_robots" : "no_published_transcript",
        );
      }
    }
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
      return failWith(jobBase(job), e, "Download failed");
    }
    const notMedia = notMediaError(file.head, file.contentType);
    if (notMedia) {
      await rm(path, { force: true }).catch(() => {});
      return fail(
        { ...jobBase(job), fileName: file.fileName, bytes: file.bytes },
        notMedia,
      );
    }
    // Downloads run in parallel; transcription and charging one at a time,
    // in input order (not download-finish order).
    await turns.wait(job.index);
    return transcribeOne(job, file);
  };
  const one = async (job: Job): Promise<boolean> => {
    try {
      return await oneJob(job);
    } finally {
      turns.done(job.index);
    }
  };

  try {
    const left = await forEachLimit(jobs, DOWNLOAD_CONCURRENCY, one);
    if (left) log(`${left} file(s) not started (max charge reached).`);
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
  return stats;
}
