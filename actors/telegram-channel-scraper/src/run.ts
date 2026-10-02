import { previewUrl, profileUrl } from "./channel.js";
import type { NormalizedInput } from "./input.js";
import { classifyPage, parsePreviewPage, parseProfilePage } from "./parse.js";
import type { Seen } from "./state.js";
import type { ChannelInfo, ErrorItem, OutputItem, Post } from "./types.js";

export type ChargeEvent = "post" | "channel-info";

export interface RunDeps {
  /** GET a t.me page (retries handled by the caller's HTTP client). */
  fetchHtml: (url: string) => Promise<string>;
  /**
   * Push one item, charging `event` if given. Return `false` to stop the run
   * (budget exhausted).
   */
  emit: (item: OutputItem, event: ChargeEvent | null) => Promise<boolean>;
  log?: (msg: string) => void;
  /** onlyNew mode: skip previously returned posts, record new ones. */
  seen?: Seen;
}

/** onlyNew state key of a post. */
export const postKey = (channel: string, postId: number): string =>
  `${channel}/${postId}`;

/**
 * onlyNew: stop a channel (newest first) after this many known posts in a
 * row, so older posts the baseline never reached aren't returned as new.
 */
export const ONLY_NEW_SEEN_STREAK = 3;

export interface ChannelStats {
  status:
    | "notStarted"
    | "ok"
    | "maxPosts"
    | "reachedSinceDate"
    | "reachedSeen"
    | "exhausted"
    | "budget"
    | ErrorItem["errorCode"];
  posts: number;
  /** onlyNew: posts already returned by an earlier run (not charged). */
  skippedSeen: number;
  pages: number;
  error?: string;
}

export interface RunStats {
  posts: number;
  channelInfos: number;
  errors: number;
  stopReason: "done" | "budget";
  channels: Record<string, ChannelStats>;
}

/** Stop a channel after this many consecutive posts older than sinceDate. */
export const OLD_STREAK_STOP = 3;

class BudgetStop extends Error {}

export async function runChannels(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const stats: RunStats = {
    posts: 0,
    channelInfos: 0,
    errors: 0,
    stopReason: "done",
    channels: {},
  };
  for (const c of input.channels) {
    stats.channels[c.username ?? c.input] = {
      status: "notStarted",
      posts: 0,
      skippedSeen: 0,
      pages: 0,
    };
  }

  /** Push (and charge); `after` runs even when this item hits the budget. */
  const emit = async (
    item: OutputItem,
    event: ChargeEvent | null,
    after?: () => void,
  ) => {
    const more = await deps.emit(item, event);
    after?.();
    if (!more) throw new BudgetStop();
  };
  const fail = async (
    st: ChannelStats,
    channel: string,
    errorCode: ErrorItem["errorCode"],
    error: string,
  ) => {
    st.status = errorCode;
    st.error = error;
    stats.errors += 1;
    log(`${channel}: ${error}`);
    await emit({ type: "error", channel, errorCode, error }, null);
  };

  try {
    for (const entry of input.channels) {
      const key = entry.username ?? entry.input;
      const st = stats.channels[key]!;
      if (!entry.username) {
        await fail(st, entry.input, "invalidInput", entry.error ?? "Invalid.");
        continue;
      }
      const channel = entry.username;
      st.status = "ok";
      const seen = new Set<number>();
      try {
        let html = await deps.fetchHtml(previewUrl(channel));
        st.pages += 1;
        const kind = classifyPage(html);
        if (kind.kind === "notFound") {
          await fail(
            st,
            channel,
            "notFound",
            `No public Telegram channel @${channel} exists.`,
          );
          continue;
        }
        if (kind.kind === "channel") {
          await fail(
            st,
            channel,
            "previewDisabled",
            `@${channel} is a channel, but its owner has disabled the public web preview, so its posts can't be read without joining.`,
          );
          continue;
        }
        if (kind.kind !== "preview") {
          await fail(
            st,
            channel,
            "notAChannel",
            `@${channel} is a ${kind.kind === "group" ? "group" : "user or bot"}, not a channel. Only public channel posts can be scraped.`,
          );
          continue;
        }

        let page = parsePreviewPage(html, channel);
        if (input.includeChannelInfo) {
          const info: ChannelInfo = {
            type: "channel",
            channel,
            title: page.channelInfo.title,
            description: page.channelInfo.description,
            subscribers: page.channelInfo.subscribers,
            photoUrl: page.channelInfo.photoUrl,
            verified: page.channelInfo.verified,
            counters: page.channelInfo.counters,
            url: profileUrl(channel),
          };
          try {
            // The landing page has the exact (not rounded) subscriber count.
            const profile = parseProfilePage(
              await deps.fetchHtml(profileUrl(channel)),
            );
            if (profile?.subscribers != null)
              info.subscribers = profile.subscribers;
            info.photoUrl ??= profile?.photoUrl ?? null;
          } catch (e) {
            log(
              `${channel}: exact subscriber count unavailable (${(e as Error).message.slice(0, 120)})`,
            );
          }
          await emit(info, "channel-info", () => (stats.channelInfos += 1));
        }

        let oldStreak = 0;
        let seenStreak = 0;
        for (;;) {
          let fresh = 0;
          for (const post of page.posts) {
            if (seen.has(post.postId)) continue;
            seen.add(post.postId);
            fresh += 1;
            if (input.since && post.date < input.since) {
              if (++oldStreak >= OLD_STREAK_STOP) {
                st.status = "reachedSinceDate";
                break;
              }
              continue;
            }
            oldStreak = 0;
            const key = postKey(channel, post.postId);
            if (deps.seen?.has(key)) {
              deps.seen.add(key);
              st.skippedSeen += 1;
              if (++seenStreak >= ONLY_NEW_SEEN_STREAK) {
                st.status = "reachedSeen";
                break;
              }
              continue;
            }
            seenStreak = 0;
            await emit(post satisfies Post, "post", () => {
              deps.seen?.add(key);
              st.posts += 1;
              stats.posts += 1;
            });
            if (st.posts >= input.maxPostsPerChannel) {
              st.status = "maxPosts";
              break;
            }
          }
          if (st.status !== "ok") break;
          const before = page.minPostId;
          if (!before || before <= 1 || (fresh === 0 && page.posts.length)) {
            st.status = "exhausted";
            break;
          }
          html = await deps.fetchHtml(previewUrl(channel, before));
          st.pages += 1;
          const next = parsePreviewPage(html, channel);
          if (next.minPostId === null || next.minPostId >= before) {
            st.status = "exhausted";
            break;
          }
          page = next;
        }
      } catch (e) {
        if (e instanceof BudgetStop) throw e;
        await fail(
          st,
          channel,
          "failed",
          `Failed after ${st.posts} posts: ${(e as Error).message.slice(0, 300)}`,
        );
      }
    }
  } catch (e) {
    if (!(e instanceof BudgetStop)) throw e;
    stats.stopReason = "budget";
    for (const st of Object.values(stats.channels))
      if (st.status === "ok") st.status = "budget";
    return stats;
  }

  const all = Object.values(stats.channels);
  if (all.length && all.every((s) => s.status === "failed")) {
    throw new Error(
      `All channels failed: ${Object.entries(stats.channels)
        .map(([c, s]) => `${c}: ${s.error}`)
        .join("; ")}`,
    );
  }
  return stats;
}
