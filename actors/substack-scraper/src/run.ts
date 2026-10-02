import type { NormalizedInput } from "./input.js";
import {
  learnPublicationNames,
  toPost,
  type Post,
  type RawPost,
} from "./post.js";
import type { Seen } from "./state.js";
import type { SubstackClient } from "./substack.js";
import { targetKey, type Target } from "./target.js";

/** Charge events (see .actor/pay_per_event.json). */
export const EVENT_POST = "post";
export const EVENT_POST_WITH_CONTENT = "post-with-content";
export type ChargeEvent = typeof EVENT_POST | typeof EVENT_POST_WITH_CONTENT;

export const eventFor = (input: NormalizedInput): ChargeEvent =>
  input.includeContent ? EVENT_POST_WITH_CONTENT : EVENT_POST;

export interface RunDeps {
  client: Pick<SubstackClient, "archivePage" | "post">;
  /** Push + charge one item. Return `false` to stop (e.g. budget exhausted). */
  emit: (item: Post) => Promise<boolean>;
  log?: (msg: string) => void;
  /** Parallel post-detail requests (includeContent). */
  concurrency?: number;
  /** onlyNew mode: skip previously returned posts (by postId), record new ones. */
  seen?: Seen;
}

export interface TargetStats {
  publicationName: string | null;
  scanned: number;
  emitted: number;
  skippedFilter: number;
  skippedDuplicate: number;
  /** onlyNew: posts already returned by an earlier run (not charged). */
  skippedSeen: number;
  failedPosts: number;
  status:
    | "ok"
    | "maxPosts"
    | "exhausted"
    | "reachedSinceDate"
    | "reachedSeen"
    | "scanLimit"
    | "notFound"
    | "failed"
    | "notStarted";
  error?: string;
}

export interface RunStats {
  emitted: number;
  stopReason: "done" | "budget";
  targets: Record<string, TargetStats>;
}

/**
 * Archive is newest-first; stop once this many consecutive posts are older
 * than sinceDate (tolerates slight ordering noise).
 */
export const OLD_STREAK_STOP = 5;

/** onlyNew: stop a publication after this many known posts in a row (newest first). */
export const ONLY_NEW_SEEN_STREAK = 3;

/** Cap on archive posts read per publication when filters discard most. */
export const scanLimit = (input: NormalizedInput): number =>
  Math.max(1000, input.maxPostsPerPublication * 20);

class BudgetReached extends Error {}

export async function runScrape(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const concurrency = deps.concurrency ?? 4;
  const stats: RunStats = { emitted: 0, stopReason: "done", targets: {} };
  const seen = new Set<number>();
  const names = new Map<number, string>();
  const limit = scanLimit(input);

  for (const t of input.targets) {
    stats.targets[targetKey(t)] = {
      publicationName: null,
      scanned: 0,
      emitted: 0,
      skippedFilter: 0,
      skippedDuplicate: 0,
      skippedSeen: 0,
      failedPosts: 0,
      status: "notStarted",
    };
  }

  /** Emit posts in order; fetch full content first when requested. */
  const emitAll = async (
    t: Target,
    st: TargetStats,
    raws: RawPost[],
  ): Promise<void> => {
    for (let i = 0; i < raws.length; i += concurrency) {
      const chunk = raws.slice(i, i + concurrency);
      const posts = await Promise.all(
        chunk.map(async (raw): Promise<Post | null> => {
          if (!input.includeContent)
            return toPost(raw, t.origin, undefined, names);
          try {
            const full =
              t.kind === "post" && raw.body_html !== undefined
                ? raw
                : await deps.client.post(t.origin, raw.slug);
            if (!full) throw new Error("post not found");
            return toPost(
              { ...raw, ...full },
              t.origin,
              { bodyHtml: full.body_html ?? null },
              names,
            );
          } catch (e) {
            st.failedPosts += 1;
            log(
              `${t.origin}/p/${raw.slug}: could not load content, skipped (not charged): ${(e as Error).message.slice(0, 200)}`,
            );
            return null;
          }
        }),
      );
      for (const post of posts) {
        if (!post) continue;
        st.publicationName ??= post.publicationName;
        const more = await deps.emit(post);
        deps.seen?.add(String(post.postId));
        st.emitted += 1;
        stats.emitted += 1;
        if (!more) throw new BudgetReached();
      }
    }
  };

  try {
    for (const t of input.targets) {
      const key = targetKey(t);
      const st = stats.targets[key]!;
      st.status = "ok";
      /** onlyNew: true (and refreshes state) if the post was returned before. */
      const wasSeen = (id: number): boolean => {
        if (!deps.seen?.has(String(id))) return false;
        deps.seen.add(String(id));
        st.skippedSeen += 1;
        return true;
      };
      try {
        if (t.kind === "post") {
          const raw = await deps.client.post(t.origin, t.slug);
          if (!raw) {
            st.status = "notFound";
            st.error = "Post not found.";
            log(`${key}: ${st.error}`);
            continue;
          }
          st.scanned += 1;
          if (seen.has(raw.id)) {
            st.skippedDuplicate += 1;
          } else {
            seen.add(raw.id);
            if (!wasSeen(raw.id)) await emitAll(t, st, [raw]);
          }
          st.status = "exhausted";
          continue;
        }

        let offset = 0;
        let oldStreak = 0;
        let seenStreak = 0;
        for (;;) {
          const page = await deps.client.archivePage(
            t.origin,
            offset,
            input.search,
          );
          if (page === null) {
            if (offset === 0) {
              st.status = "notFound";
              st.error = "Publication not found (is it a Substack URL?).";
              log(`${key}: ${st.error}`);
            } else {
              st.status = "exhausted";
            }
            break;
          }
          if (page.length === 0) {
            st.status = "exhausted";
            break;
          }
          offset += page.length;
          learnPublicationNames(page, names);

          const batch: RawPost[] = [];
          let newOnPage = 0;
          let stop: TargetStats["status"] | undefined;
          for (const raw of page) {
            st.scanned += 1;
            if (seen.has(raw.id)) {
              st.skippedDuplicate += 1;
              continue;
            }
            seen.add(raw.id);
            newOnPage += 1;
            if (input.since && raw.post_date && raw.post_date < input.since) {
              st.skippedFilter += 1;
              // Search results are ranked by relevance, not date.
              if (!input.search && ++oldStreak >= OLD_STREAK_STOP) {
                stop = "reachedSinceDate";
                break;
              }
              continue;
            }
            oldStreak = 0;
            if (wasSeen(raw.id)) {
              // Search results are ranked by relevance, not date.
              if (!input.search && ++seenStreak >= ONLY_NEW_SEEN_STREAK) {
                stop = "reachedSeen";
                break;
              }
              continue;
            }
            seenStreak = 0;
            batch.push(raw);
            if (st.emitted + batch.length >= input.maxPostsPerPublication) {
              stop = "maxPosts";
              break;
            }
          }
          await emitAll(t, st, batch);
          if (stop) {
            st.status = stop;
            break;
          }
          if (newOnPage === 0) {
            st.status = "exhausted";
            break;
          }
          if (st.scanned >= limit) {
            st.status = "scanLimit";
            log(
              `${key}: read ${limit} posts without reaching ${input.maxPostsPerPublication} matches; stopping this publication.`,
            );
            break;
          }
        }
      } catch (e) {
        if (e instanceof BudgetReached) throw e;
        st.status = "failed";
        st.error = (e as Error).message.slice(0, 500);
        log(`${key}: failed after ${st.emitted} posts, skipping: ${st.error}`);
      }
    }
  } catch (e) {
    if (!(e instanceof BudgetReached)) throw e;
    stats.stopReason = "budget";
    return stats;
  }

  const all = Object.values(stats.targets);
  if (all.length && all.every((s) => s.status === "failed")) {
    throw new Error(
      `All publications failed: ${Object.entries(stats.targets)
        .map(([k, s]) => `${k}: ${s.error}`)
        .join("; ")}`,
    );
  }
  return stats;
}
