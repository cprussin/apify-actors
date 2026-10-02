import { RiskControlError } from "./bili.js";
import type { NormalizedInput } from "./input.js";
import {
  videoRefKey,
  type ListedVideo,
  type Video,
  type VideoRef,
} from "./parse.js";
import type { BiliSource } from "./source.js";
import type { Seen } from "./state.js";

export interface RunDeps {
  source: Pick<
    BiliSource,
    "trending" | "search" | "findUser" | "userVideos" | "video" | "comments"
  >;
  /** Charge + push one video. Return `false` to stop (budget exhausted). */
  emit: (item: Video) => Promise<boolean>;
  log?: (msg: string) => void;
  /** onlyNew mode: skip previously returned videos (by bvid), record new ones. */
  seen?: Seen;
}

/**
 * onlyNew, newest-first lists (channels, search by newest): stop after this
 * many known videos in a row, so older videos the baseline never reached
 * aren't returned as new.
 */
export const ONLY_NEW_SEEN_STREAK = 3;

export interface GroupStats {
  emitted: number;
  notFound: number;
  failed: number;
  commentErrors: number;
  /** onlyNew: videos already returned by an earlier run (not charged). */
  skippedSeen: number;
  status:
    "ok" | "maxItems" | "exhausted" | "notFound" | "failed" | "notStarted";
  error?: string;
}

export interface RunStats {
  emitted: number;
  stopReason: "done" | "budget";
  groups: Record<string, GroupStats>;
}

interface Group {
  label: string;
  /** Lazily lists videos; `source` is the value written to each item. */
  list: () => AsyncGenerator<ListedVideo | VideoRef>;
  source: string;
}

async function* fromArray(refs: VideoRef[]): AsyncGenerator<VideoRef> {
  yield* refs;
}

function groups(
  input: NormalizedInput,
  deps: RunDeps,
  log: (m: string) => void,
): Group[] {
  const s = deps.source;
  switch (input.mode) {
    case "trending":
      return [
        { label: "trending", source: "trending", list: () => s.trending() },
      ];
    case "search":
      return input.keywords.map((kw) => ({
        label: `search:${kw}`,
        source: `search:${kw}`,
        list: () => s.search(kw, input.searchOrder),
      }));
    case "videos":
      return [
        {
          label: "videos",
          source: "video",
          list: () => fromArray(input.videos),
        },
      ];
    case "user":
      return input.users.map((u) => {
        const label = "mid" in u ? `user:${u.mid}` : `user:${u.name}`;
        const g: Group = {
          label,
          source: label,
          list: async function* () {
            let mid: string;
            if ("mid" in u) mid = u.mid;
            else {
              const hit = await s.findUser(u.name);
              if (!hit) {
                log(`${label}: no Bilibili user found.`);
                return;
              }
              mid = hit.mid;
              g.source = `user:${mid}`;
            }
            yield* s.userVideos(mid);
          },
        };
        return g;
      });
  }
}

export async function runScrape(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const stats: RunStats = { emitted: 0, stopReason: "done", groups: {} };
  const seen = new Set<string>();
  const all = groups(input, deps, log);
  for (const g of all) {
    stats.groups[g.label] = {
      emitted: 0,
      notFound: 0,
      failed: 0,
      commentErrors: 0,
      skippedSeen: 0,
      status: "notStarted",
    };
  }

  for (const g of all) {
    const st = stats.groups[g.label]!;
    st.status = "ok";
    let listed = 0;
    let seenStreak = 0;
    /** onlyNew: true (and refreshes state) if the video was returned before. */
    const wasSeen = (bvid: string): boolean => {
      if (!deps.seen?.has(bvid)) return false;
      deps.seen.add(bvid);
      st.skippedSeen += 1;
      seenStreak += 1;
      return true;
    };
    try {
      for await (const item of g.list()) {
        listed += 1;
        const ref: VideoRef = "bvid" in item ? { bvid: item.bvid } : item;
        const key = videoRefKey(ref);
        if (seen.has(key)) continue;
        seen.add(key);
        if ("bvid" in ref && wasSeen(ref.bvid)) {
          const newestFirst =
            input.mode === "user" ||
            (input.mode === "search" && input.searchOrder === "newest");
          if (newestFirst && seenStreak >= ONLY_NEW_SEEN_STREAK) {
            st.status = "exhausted";
            break;
          }
          continue;
        }
        const category = "category" in item ? item.category : undefined;

        let video: Video | null;
        try {
          video = await deps.source.video(ref, { source: g.source, category });
        } catch (e) {
          if (e instanceof RiskControlError) throw e;
          st.failed += 1;
          log(
            `${g.label}: ${key} failed: ${(e as Error).message.slice(0, 300)}`,
          );
          continue;
        }
        if (!video) {
          st.notFound += 1;
          log(`${g.label}: ${key} not found, deleted or hidden; skipped.`);
          continue;
        }
        if (seen.has(video.bvid) && key !== video.bvid) continue;
        seen.add(video.bvid);
        if (key !== video.bvid && wasSeen(video.bvid)) continue;
        seenStreak = 0;

        if (input.includeComments) {
          video.comments = [];
          if (video.replies > 0) {
            try {
              video.comments = await deps.source.comments(
                video.aid,
                video.bvid,
                input.maxCommentsPerVideo,
              );
            } catch (e) {
              if (e instanceof RiskControlError) throw e;
              st.commentErrors += 1;
              log(
                `${g.label}: comments for ${video.bvid} failed: ${(e as Error).message.slice(0, 300)}`,
              );
            }
          }
        }

        const more = await deps.emit(video);
        deps.seen?.add(video.bvid);
        st.emitted += 1;
        stats.emitted += 1;
        if (!more) {
          stats.stopReason = "budget";
          return stats;
        }
        if (st.emitted >= input.maxItems) {
          st.status = "maxItems";
          break;
        }
      }
      if (st.status === "ok") {
        st.status = listed === 0 ? "notFound" : "exhausted";
        if (listed === 0) log(`${g.label}: no videos found.`);
      }
    } catch (e) {
      st.status = "failed";
      st.error = (e as Error).message.slice(0, 500);
      log(`${g.label}: failed after ${st.emitted} videos: ${st.error}`);
    }
  }

  const skipped = Object.values(stats.groups).reduce(
    (n, s) => n + s.skippedSeen,
    0,
  );
  if (stats.emitted === 0 && skipped === 0) {
    const detail = Object.entries(stats.groups)
      .map(
        ([k, s]) =>
          `${k}: ${s.status}${s.error ? ` (${s.error})` : ""}${s.notFound ? `, ${s.notFound} not found` : ""}${s.failed ? `, ${s.failed} failed` : ""}`,
      )
      .join("; ");
    throw new Error(`No videos scraped. ${detail}`);
  }
  return stats;
}
