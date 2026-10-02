import { parsePlaylistPage, parseResolvedChannelId } from "./browse.js";
import type { NormalizedInput } from "./input.js";
import { uploadsPlaylistId, type Source } from "./sources.js";
import type { Seen } from "./state.js";
import {
  errorItem,
  fetchTranscript,
  type TranscriptItem,
} from "./transcript.js";
import { BlockedError, type YouTubeClient } from "./youtube.js";

export interface VideoJob {
  videoId: string;
  source: string;
}

export interface RunDeps {
  /** One client per worker, so each keeps its own sticky proxy session. */
  newClient: () => YouTubeClient;
  /**
   * Push one item; `charge` is true for successful transcripts.
   * Return `false` to stop (charge limit reached).
   */
  emit: (item: TranscriptItem, charge: boolean) => Promise<boolean>;
  log?: (msg: string) => void;
  /** Safety net against runaway pagination. */
  maxBrowsePages?: number;
  /**
   * onlyNew mode: skip videos whose transcript was returned before, record
   * new ones. Failed videos are not recorded, so they're retried next run.
   */
  seen?: Seen;
}

/**
 * onlyNew, channel tabs (newest first): stop after this many known videos in
 * a row, so older videos the baseline never reached aren't returned as new.
 */
export const ONLY_NEW_SEEN_STREAK = 3;

export interface RunStats {
  videos: number;
  succeeded: number;
  failed: number;
  failures: Record<string, number>;
  /** onlyNew: videos whose transcript was returned by an earlier run (not charged). */
  skippedSeen: number;
  sourceErrors: string[];
  stopReason: "done" | "budget";
  requests: number;
  retries: number;
  blocks: number;
}

/**
 * Expand one channel/playlist source into up to `max` video IDs. Videos for
 * which `isKnown` returns true (onlyNew) are left out and don't count.
 */
export async function expandSource(
  yt: YouTubeClient,
  src: Source,
  max: number,
  maxPages = 100,
  isKnown: (videoId: string) => boolean = () => false,
): Promise<string[]> {
  if (src.kind === "video") return isKnown(src.videoId) ? [] : [src.videoId];
  let playlistId: string;
  if (src.kind === "playlist") {
    playlistId = src.playlistId;
  } else {
    const channelId =
      src.channelId ?? parseResolvedChannelId(await yt.resolveUrl(src.url));
    if (!channelId) throw new Error(`Channel not found: ${src.input}`);
    playlistId = uploadsPlaylistId(channelId, src.tab);
  }
  const ids: string[] = [];
  const known = new Set<string>();
  let knownStreak = 0;
  let page = parsePlaylistPage(
    await yt.browse({ browseId: `VL${playlistId}` }),
  );
  for (let n = 1; ; n++) {
    for (const id of page.videoIds) {
      if (ids.includes(id) || known.has(id)) continue;
      if (isKnown(id)) {
        known.add(id);
        // Channel tabs are newest first; playlists can be in any order.
        if (src.kind === "channel" && ++knownStreak >= ONLY_NEW_SEEN_STREAK)
          return ids;
        continue;
      }
      knownStreak = 0;
      ids.push(id);
      if (ids.length >= max) return ids;
    }
    if (!page.continuation || n >= maxPages) break;
    page = parsePlaylistPage(
      await yt.browse({ continuation: page.continuation }),
    );
  }
  if (!ids.length && !known.size)
    throw new Error(`No videos found for ${src.input} (empty or private)`);
  return ids;
}

export async function runTranscripts(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const stats: RunStats = {
    videos: 0,
    succeeded: 0,
    failed: 0,
    failures: {},
    skippedSeen: 0,
    sourceErrors: [],
    stopReason: "done",
    requests: 0,
    retries: 0,
    blocks: 0,
  };
  const clients: YouTubeClient[] = [];
  const client = () => {
    const c = deps.newClient();
    clients.push(c);
    return c;
  };

  // 1. Expand sources into a de-duplicated job list.
  const jobs: VideoJob[] = [];
  const queued = new Set<string>();
  const expander = client();
  const isKnown = (videoId: string): boolean => {
    if (!deps.seen?.has(videoId)) return false;
    deps.seen.add(videoId);
    stats.skippedSeen += 1;
    return true;
  };
  for (const src of input.sources) {
    let ids: string[];
    try {
      ids = await expandSource(
        expander,
        src,
        input.maxVideosPerSource,
        deps.maxBrowsePages,
        isKnown,
      );
    } catch (e) {
      const msg = `${src.input}: ${(e as Error).message}`;
      stats.sourceErrors.push(msg);
      log(`Skipping source ${msg}`);
      continue;
    }
    if (src.kind !== "video") log(`${src.input}: ${ids.length} videos`);
    for (const videoId of ids) {
      if (queued.has(videoId)) continue;
      queued.add(videoId);
      jobs.push({ videoId, source: src.input });
    }
  }
  stats.videos = jobs.length;

  // 2. Fetch transcripts with a small worker pool; emit in completion order.
  let next = 0;
  let stopped = false;
  const worker = async () => {
    const yt = client();
    while (!stopped && next < jobs.length) {
      const job = jobs[next++]!;
      let item: TranscriptItem;
      try {
        item = await fetchTranscript(yt, job.videoId, job.source, {
          languages: input.languages,
          allowAutoGenerated: input.allowAutoGenerated,
          fallbackToAnyLanguage: input.fallbackToAnyLanguage,
          translateTo: input.translateTo,
          formats: input.formats,
          includeMetadata: input.includeMetadata,
          log,
        });
      } catch (e) {
        const blocked = e instanceof BlockedError;
        item = errorItem(
          job.videoId,
          job.source,
          blocked ? "blocked" : "requestFailed",
          blocked
            ? `YouTube blocked the request after retries. Use a RESIDENTIAL proxy. (${(e as Error).message})`
            : (e as Error).message,
        );
      }
      // Emits are serialized so nothing is pushed after the budget runs out.
      const emitted = emitChain.then(async () => {
        if (stopped) return;
        const ok = item.error === null;
        if (ok) stats.succeeded += 1;
        else {
          stats.failed += 1;
          const code = item.errorCode ?? "requestFailed";
          stats.failures[code] = (stats.failures[code] ?? 0) + 1;
          log(`${job.videoId}: ${item.error}`);
        }
        const more = await deps.emit(item, ok);
        if (ok) deps.seen?.add(job.videoId);
        if (!more) {
          stopped = true;
          stats.stopReason = "budget";
        }
      });
      emitChain = emitted;
      await emitted;
    }
  };
  let emitChain: Promise<void> = Promise.resolve();
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(input.maxConcurrency, jobs.length)) },
      worker,
    ),
  );

  for (const c of clients) {
    stats.requests += c.stats.requests;
    stats.retries += c.stats.retries;
    stats.blocks += c.stats.blocks;
  }
  return stats;
}
