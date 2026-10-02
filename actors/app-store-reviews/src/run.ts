import type { NormalizedInput } from "./input.js";
import { reviewKey, type Review, type Store } from "./review.js";
import type { ReviewSource, SourceQuery } from "./source.js";
import { laterOf, type Monitor } from "./state.js";

export interface RunDeps {
  sources: Record<Store, ReviewSource>;
  /** Push + charge one item. Return `false` to stop (e.g. budget exhausted). */
  emit: (item: Review) => Promise<boolean>;
  log?: (msg: string) => void;
  /** onlyNew mode: skips previously emitted reviews and records new ones. */
  monitor?: Monitor;
  /** Called after each app, e.g. to persist monitor state. */
  afterApp?: () => Promise<void>;
}

export interface AppStats {
  appName: string | null;
  scanned: number;
  emitted: number;
  skippedFilter: number;
  skippedDuplicate: number;
  /** onlyNew: reviews already returned by an earlier run. */
  skippedSeen: number;
  status:
    | "ok"
    | "maxReviews"
    | "exhausted"
    | "reachedSinceDate"
    | "scanLimit"
    | "notFound"
    | "failed"
    | "notStarted";
  error?: string;
}

export interface RunStats {
  emitted: number;
  stopReason: "done" | "budget";
  apps: Record<string, AppStats>;
}

/**
 * With sort=newest, stop once this many consecutive reviews are older than
 * sinceDate (tolerates slight ordering noise, e.g. edited reviews).
 */
export const OLD_STREAK_STOP = 20;

/** Cap on reviews read per app when filters discard most of them. */
export const scanLimit = (input: NormalizedInput): number =>
  Math.max(2000, input.maxReviewsPerApp * 20);

export async function runReviews(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const stats: RunStats = { emitted: 0, stopReason: "done", apps: {} };
  const seen = new Set<string>();
  const q: SourceQuery = {
    country: input.country,
    language: input.language,
    sort: input.sort,
  };
  const limit = scanLimit(input);

  for (const ref of input.apps) {
    const label = `${ref.store}:${ref.id}`;
    stats.apps[label] = {
      appName: null,
      scanned: 0,
      emitted: 0,
      skippedFilter: 0,
      skippedDuplicate: 0,
      skippedSeen: 0,
      status: "notStarted",
    };
  }

  for (const ref of input.apps) {
    const label = `${ref.store}:${ref.id}`;
    const st = stats.apps[label]!;
    const source = deps.sources[ref.store];
    const monitor = deps.monitor;
    const since = laterOf(input.since, monitor?.since(label));
    st.status = "ok";
    try {
      const app = await source.resolve(ref.id, q);
      if (!app) {
        st.status = "notFound";
        st.error = `App not found in the ${input.country.toUpperCase()} ${ref.store === "apple" ? "App Store" : "Google Play store"}.`;
        log(`${label}: ${st.error}`);
        continue;
      }
      st.appName = app.name;
      let oldStreak = 0;
      const it = source.reviews(app, q);
      try {
        for await (const raw of it) {
          st.scanned += 1;
          if (since && raw.date < since) {
            st.skippedFilter += 1;
            if (input.sort === "newest" && ++oldStreak >= OLD_STREAK_STOP) {
              st.status = "reachedSinceDate";
              break;
            }
            continue;
          }
          oldStreak = 0;
          if (raw.rating < input.minRating || raw.rating > input.maxRating) {
            st.skippedFilter += 1;
          } else if (monitor?.isSeen(label, raw.reviewId)) {
            st.skippedSeen += 1;
          } else {
            const review: Review = {
              store: ref.store,
              appId: app.id,
              appName: app.name,
              ...raw,
              country: input.country,
              language: ref.store === "google" ? input.language : null,
            };
            const key = reviewKey(review);
            if (seen.has(key)) {
              st.skippedDuplicate += 1;
            } else {
              seen.add(key);
              const more = await deps.emit(orderFields(review));
              st.emitted += 1;
              stats.emitted += 1;
              monitor?.record(label, raw.reviewId, raw.date);
              if (!more) {
                stats.stopReason = "budget";
                if (monitor) {
                  monitor.finish(label, false);
                  await deps.afterApp?.();
                }
                return stats;
              }
              if (st.emitted >= input.maxReviewsPerApp) {
                st.status = "maxReviews";
                break;
              }
            }
          }
          if (st.scanned >= limit) {
            st.status = "scanLimit";
            log(
              `${label}: read ${limit} reviews without reaching ${input.maxReviewsPerApp} matches; stopping this app.`,
            );
            break;
          }
        }
        if (st.status === "ok") st.status = "exhausted";
      } finally {
        await it.return(undefined);
      }
    } catch (e) {
      st.status = "failed";
      st.error = (e as Error).message.slice(0, 500);
      log(
        `${label}: failed after ${st.emitted} reviews, skipping app: ${st.error}`,
      );
    }
    if (monitor) {
      if (st.status !== "failed") {
        monitor.finish(
          label,
          st.status === "exhausted" || st.status === "reachedSinceDate",
        );
      }
      await deps.afterApp?.();
    }
  }

  const all = Object.values(stats.apps);
  if (all.length && all.every((s) => s.status === "failed")) {
    throw new Error(
      `All apps failed: ${Object.entries(stats.apps)
        .map(([c, s]) => `${c}: ${s.error}`)
        .join("; ")}`,
    );
  }
  return stats;
}

/** Stable key order in the dataset, matching the schema. */
function orderFields(r: Review): Review {
  return {
    store: r.store,
    appId: r.appId,
    appName: r.appName,
    reviewId: r.reviewId,
    rating: r.rating,
    title: r.title,
    text: r.text,
    author: r.author,
    date: r.date,
    appVersion: r.appVersion,
    developerReply: r.developerReply,
    developerReplyDate: r.developerReplyDate,
    helpfulCount: r.helpfulCount,
    country: r.country,
    language: r.language,
    url: r.url,
  };
}
