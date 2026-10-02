import { BASE } from "./http.js";
import type { NormalizedInput, Target } from "./input.js";
import { parsePreview, type AdContent } from "./preview.js";
import {
  bestAdvertiser,
  type Format,
  type Platform,
  type RawAd,
  type SearchFilter,
} from "./rpc.js";
import type { Seen } from "./state.js";
import type { TransparencyApi } from "./transparency.js";

export interface Ad {
  advertiserId: string;
  advertiserName: string | null;
  creativeId: string;
  format: Format | null;
  firstShown: string | null;
  lastShown: string | null;
  totalDaysShown: number | null;
  headline: string | null;
  description: string | null;
  displayUrl: string | null;
  callToAction: string | null;
  texts: string[];
  appId: string | null;
  appName: string | null;
  appStore: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  videoId: string | null;
  videoUrl: string | null;
  width: number | null;
  height: number | null;
  targetDomain: string | null;
  /** Region filter the ad was found with (null = anywhere). */
  region: string | null;
  /** Platform filter the ad was found with (null = all platforms). */
  platform: Platform | null;
  adUrl: string;
  advertiserUrl: string;
  previewUrl: string | null;
  query: string;
  contentError?: string;
}

export interface AdvertiserResult {
  query: string;
  advertiserId: string;
  advertiserName: string;
  country: string | null;
  adCountMin: number | null;
  adCountMax: number | null;
  advertiserUrl: string;
}

export type ChargeEvent = "ad" | "advertiser";

export interface RunDeps {
  api: TransparencyApi;
  /** Push + charge one item. Return `false` to stop (budget exhausted). */
  emit: (item: Ad | AdvertiserResult, event: ChargeEvent) => Promise<boolean>;
  log?: (msg: string) => void;
  /** Parallel preview downloads. */
  concurrency?: number;
  /**
   * onlyNew mode: skip previously returned ads (by creativeId) or advertisers
   * (by advertiserId), record new ones.
   */
  seen?: Seen;
}

export interface TargetStats {
  advertiserId: string | null;
  advertiserName: string | null;
  emitted: number;
  totalEstimate: [number, number] | null;
  status: "notStarted" | "done" | "maxAds" | "notFound" | "failed";
  error?: string;
}

export interface RunStats {
  emitted: number;
  contentErrors: number;
  /** onlyNew: items already returned by an earlier run (not charged). */
  skippedSeen: number;
  stopReason: "done" | "budget";
  targets: Record<string, TargetStats>;
}

export const PAGE_SIZE = 100;
const MAX_PAGES = 2000;
/** onlyNew: stop paging a format after this many pages with nothing new. */
export const ONLY_NEW_STALE_PAGES = 2;

/** onlyNew state keys. */
export const adKey = (creativeId: string) => `ad:${creativeId}`;
export const advertiserKey = (advertiserId: string) => `adv:${advertiserId}`;

const advertiserUrl = (id: string, region: string | null) =>
  `${BASE}/advertiser/${id}?region=${region ?? "anywhere"}`;

export function buildAd(
  raw: RawAd,
  content: AdContent | null,
  ctx: {
    input: NormalizedInput;
    target: Target;
    contentError?: string;
  },
): Ad {
  const { input, target } = ctx;
  const region = input.region;
  const videoId = content?.youtubeVideoId ?? null;
  const imageUrls = [
    ...new Set([
      ...(raw.imageUrl ? [raw.imageUrl] : []),
      ...(content?.imageUrls ?? []),
    ]),
  ];
  const displayDomain = content?.displayUrl
    ?.replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  const ad: Ad = {
    advertiserId: raw.advertiserId,
    advertiserName: raw.advertiserName,
    creativeId: raw.creativeId,
    format: raw.format,
    firstShown: raw.firstShown,
    lastShown: raw.lastShown,
    totalDaysShown: raw.totalDaysShown,
    headline: content?.headline ?? null,
    description: content?.description ?? null,
    displayUrl: content?.displayUrl ?? null,
    callToAction: content?.callToAction ?? null,
    texts: content?.texts ?? [],
    appId: content?.app?.appId ?? null,
    appName: content?.app?.appName ?? null,
    appStore: content?.app?.appStore ?? null,
    imageUrl:
      imageUrls[0] ??
      (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null),
    imageUrls,
    videoId,
    videoUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
    width: raw.width ?? content?.width ?? null,
    height: raw.height ?? content?.height ?? null,
    targetDomain:
      raw.targetDomain ??
      (target.kind === "domain" ? target.domain : null) ??
      displayDomain ??
      null,
    region,
    platform: input.platform,
    adUrl: `${BASE}/advertiser/${raw.advertiserId}/creative/${raw.creativeId}?region=${region ?? "anywhere"}`,
    advertiserUrl: advertiserUrl(raw.advertiserId, region),
    previewUrl: raw.previewUrl,
    query: target.query,
  };
  if (ctx.contentError) ad.contentError = ctx.contentError;
  return ad;
}

/** Runs `fn` over `items` with at most `limit` in flight; keeps order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

class BudgetReached extends Error {}

export async function runScraper(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const stats: RunStats = {
    emitted: 0,
    contentErrors: 0,
    skippedSeen: 0,
    stopReason: "done",
    targets: {},
  };
  /** onlyNew: true (and refreshes state) if `key` was returned before. */
  const wasSeen = (key: string): boolean => {
    if (!deps.seen?.has(key)) return false;
    deps.seen.add(key);
    stats.skippedSeen += 1;
    return true;
  };
  for (const t of input.targets) {
    stats.targets[t.query] = {
      advertiserId: t.kind === "id" ? t.advertiserId : null,
      advertiserName: null,
      emitted: 0,
      totalEstimate: null,
      status: "notStarted",
    };
  }

  const emit = async (item: Ad | AdvertiserResult, event: ChargeEvent) => {
    const more = await deps.emit(item, event);
    deps.seen?.add(
      "creativeId" in item
        ? adKey(item.creativeId)
        : advertiserKey(item.advertiserId),
    );
    stats.emitted += 1;
    if (!more) throw new BudgetReached();
  };

  try {
    for (const target of input.targets) {
      const st = stats.targets[target.query]!;
      try {
        if (input.mode === "advertisers") {
          await searchAdvertisers(target, input, deps.api, st, emit, wasSeen);
        } else {
          await scrapeAds(target, input, deps, st, emit, stats, wasSeen);
        }
      } catch (e) {
        if (e instanceof BudgetReached) throw e;
        st.status = "failed";
        st.error = (e as Error).message.slice(0, 500);
        log(
          `${target.query}: failed after ${st.emitted} items, skipping: ${st.error}`,
        );
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
      `All advertisers failed: ${Object.entries(stats.targets)
        .map(([q, s]) => `${q}: ${s.error}`)
        .join("; ")}`,
    );
  }
  return stats;
}

async function searchAdvertisers(
  target: Target,
  input: NormalizedInput,
  api: TransparencyApi,
  st: TargetStats,
  emit: (item: AdvertiserResult, event: ChargeEvent) => Promise<void>,
  wasSeen: (key: string) => boolean,
) {
  const s = await api.suggestions(target.query, input.maxAdvertisersPerQuery);
  if (!s.advertisers.length) {
    st.status = "notFound";
    st.error = "No advertiser matches this name.";
    return;
  }
  for (const a of s.advertisers.slice(0, input.maxAdvertisersPerQuery)) {
    if (wasSeen(advertiserKey(a.advertiserId))) continue;
    await emit(
      {
        query: target.query,
        ...a,
        advertiserUrl: advertiserUrl(a.advertiserId, input.region),
      },
      "advertiser",
    );
    st.emitted += 1;
  }
  st.status = "done";
}

async function scrapeAds(
  target: Target,
  input: NormalizedInput,
  deps: RunDeps,
  st: TargetStats,
  emit: (item: Ad, event: ChargeEvent) => Promise<void>,
  stats: RunStats,
  wasSeen: (key: string) => boolean,
) {
  const log = deps.log ?? (() => {});
  const base: SearchFilter = {
    regionId: input.regionId ?? undefined,
    platform: input.platform ?? undefined,
    startDate: input.startDate ?? undefined,
    endDate: input.endDate ?? undefined,
  };
  if (target.kind === "id") {
    base.advertiserIds = [target.advertiserId];
  } else if (target.kind === "domain") {
    base.domain = target.domain;
  } else {
    const s = await deps.api.suggestions(target.name, 10);
    const best = bestAdvertiser(target.name, s.advertisers);
    if (!best) {
      st.status = "notFound";
      st.error = `No advertiser named "${target.name}" in the Transparency Center. Try the advertiser's legal name, domain or ID.`;
      log(`${target.query}: ${st.error}`);
      return;
    }
    st.advertiserId = best.advertiserId;
    st.advertiserName = best.advertiserName;
    base.advertiserIds = [best.advertiserId];
    log(
      `${target.query}: using advertiser "${best.advertiserName}" (${best.advertiserId}, ${best.country ?? "?"}).`,
    );
  }

  const seen = new Set<string>();
  const formats: (Format | undefined)[] = input.formats.length
    ? input.formats
    : [undefined];
  for (let fi = 0; fi < formats.length; fi++) {
    const remaining = input.maxAdsPerAdvertiser - st.emitted;
    // Share what's left of the quota between the remaining formats.
    const quota = Math.ceil(remaining / (formats.length - fi));
    let got = 0;
    let stalePages = 0;
    let token: string | undefined;
    for (let page = 0; page < MAX_PAGES && got < quota; page++) {
      const res = await deps.api.searchCreatives(
        { ...base, format: formats[fi] },
        // onlyNew: full pages, since known ads don't count toward the quota.
        deps.seen ? PAGE_SIZE : Math.min(PAGE_SIZE, quota - got),
        token,
      );
      if (page === 0 && fi === 0) st.totalEstimate = res.totalEstimate;
      const fresh = res.ads
        .filter((a) => !seen.has(a.creativeId) && !wasSeen(adKey(a.creativeId)))
        .slice(0, quota - got);
      for (const a of fresh) seen.add(a.creativeId);
      const ads = await mapLimit(fresh, deps.concurrency ?? 5, async (raw) => {
        if (!input.includeAdContent || !raw.previewUrl) {
          return buildAd(raw, null, { input, target });
        }
        try {
          const js = await deps.api.preview(raw.previewUrl);
          return buildAd(raw, parsePreview(js, raw.advertiserName), {
            input,
            target,
          });
        } catch (e) {
          stats.contentErrors += 1;
          return buildAd(raw, null, {
            input,
            target,
            contentError: (e as Error).message.slice(0, 200),
          });
        }
      });
      for (const ad of ads) {
        if (!st.advertiserName && ad.advertiserName)
          st.advertiserName = ad.advertiserName;
        st.emitted += 1;
        got += 1;
        await emit(ad, "ad");
      }
      token = res.nextPageToken ?? undefined;
      if (!token || !res.ads.length) break;
      stalePages = fresh.length ? 0 : stalePages + 1;
      if (deps.seen && stalePages >= ONLY_NEW_STALE_PAGES) break;
    }
  }
  st.status = st.emitted >= input.maxAdsPerAdvertiser ? "maxAds" : "done";
}
