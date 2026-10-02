/** One person (maker or hunter). Fields Product Hunt hides are null. */
export interface Person {
  id: string | null;
  name: string | null;
  username: string | null;
  headline: string | null;
  profileUrl: string | null;
  twitterUsername: string | null;
  websiteUrl: string | null;
  avatarUrl: string | null;
}

export interface Comment {
  id: string;
  body: string;
  createdAt: string | null;
  votesCount: number | null;
  parentId: string | null;
  url: string | null;
  author: Person | null;
}

export interface Media {
  type: string | null;
  url: string | null;
  videoUrl: string | null;
}

export type SourceName = "feed" | "api";

/** One Product Hunt launch (a "post"), as written to the dataset. */
export interface Launch {
  id: string;
  name: string;
  tagline: string | null;
  description: string | null;
  slug: string | null;
  url: string;
  website: string | null;
  websiteRedirectUrl: string | null;
  topics: string[];
  votesCount: number | null;
  commentsCount: number | null;
  reviewsCount: number | null;
  reviewsRating: number | null;
  dailyRank: number | null;
  weeklyRank: number | null;
  monthlyRank: number | null;
  launchDate: string | null;
  createdAt: string | null;
  featuredAt: string | null;
  featured: boolean | null;
  thumbnail: string | null;
  media: Media[];
  hunter: Person | null;
  makers: Person[] | null;
  pricingType: string | null;
  productLinks: { type: string | null; url: string }[];
  comments?: Comment[];
  source: SourceName;
  scrapedAt: string;
}

/** Stable key order in the dataset, matching the schema. */
export function orderLaunch(l: Launch): Launch {
  const out: Launch = {
    id: l.id,
    name: l.name,
    tagline: l.tagline,
    description: l.description,
    slug: l.slug,
    url: l.url,
    website: l.website,
    websiteRedirectUrl: l.websiteRedirectUrl,
    topics: l.topics,
    votesCount: l.votesCount,
    commentsCount: l.commentsCount,
    reviewsCount: l.reviewsCount,
    reviewsRating: l.reviewsRating,
    dailyRank: l.dailyRank,
    weeklyRank: l.weeklyRank,
    monthlyRank: l.monthlyRank,
    launchDate: l.launchDate,
    createdAt: l.createdAt,
    featuredAt: l.featuredAt,
    featured: l.featured,
    thumbnail: l.thumbnail,
    media: l.media,
    hunter: l.hunter,
    makers: l.makers,
    pricingType: l.pricingType,
    productLinks: l.productLinks,
    source: l.source,
    scrapedAt: l.scrapedAt,
  };
  if (l.comments) out.comments = l.comments;
  return out;
}

export const PH_TZ = "America/Los_Angeles";

const ymdFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: PH_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar date (YYYY-MM-DD) in Pacific Time, Product Hunt's launch day. */
export function ptDate(iso: string | Date | null | undefined): string | null {
  if (!iso) return null;
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return null;
  return ymdFmt.format(d);
}

/** Minutes Pacific Time is behind UTC at `instant` (480 or 420). */
function ptOffsetMinutes(instant: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PH_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const local = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
  );
  return Math.round((instant - local) / 60_000);
}

/** UTC instant of 00:00 Pacific Time on `ymd`. */
export function ptMidnight(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const utcMidnight = Date.UTC(y, m - 1, d);
  // 08:00 UTC is 00:00 or 01:00 local, before the 2am DST switch, so the
  // offset there is the offset at local midnight.
  const off = ptOffsetMinutes(utcMidnight + 8 * 3600_000);
  return new Date(utcMidnight + off * 60_000);
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Monday of the ISO week containing `ymd`. */
export function weekStart(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(ymd, -((dow + 6) % 7));
}

export function monthStart(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

export function nextMonth(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

export type Period = "daily" | "weekly" | "monthly";

/** A leaderboard window: [start, end) as Pacific-Time dates. */
export interface Window {
  period: Period;
  start: string;
  end: string;
  label: string;
}

/** Leaderboard windows covering [from, to] (inclusive), oldest first. */
export function windows(period: Period, from: string, to: string): Window[] {
  const out: Window[] = [];
  let cur =
    period === "daily"
      ? from
      : period === "weekly"
        ? weekStart(from)
        : monthStart(from);
  while (cur <= to) {
    const end =
      period === "daily"
        ? addDays(cur, 1)
        : period === "weekly"
          ? addDays(cur, 7)
          : nextMonth(cur);
    const label =
      period === "daily"
        ? cur
        : period === "weekly"
          ? `week of ${cur}`
          : cur.slice(0, 7);
    out.push({ period, start: cur, end, label });
    cur = end;
  }
  return out;
}

export class PostRefError extends Error {}

/** A post to look up: numeric id or slug. */
export type PostRef = { id: string } | { slug: string };

/**
 * Accepts https://www.producthunt.com/posts/<slug>,
 * /products/<product>/launches/<slug>, /products/<slug>, a bare slug, or a
 * numeric post id.
 */
export function parsePostRef(s: string): PostRef {
  const t = s.trim();
  if (/^\d+$/.test(t)) return { id: t };
  if (/^[a-z0-9][a-z0-9-]*$/i.test(t)) return { slug: t.toLowerCase() };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    throw new PostRefError(`"${s}" is not a Product Hunt URL, slug or id.`);
  }
  if (!/(^|\.)producthunt\.com$/i.test(u.hostname))
    throw new PostRefError(`"${s}" is not a producthunt.com URL.`);
  const parts = u.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("launches");
  if (parts[0] === "products" && idx > 0 && parts[idx + 1])
    return { slug: parts[idx + 1]!.toLowerCase() };
  if ((parts[0] === "posts" || parts[0] === "products") && parts[1])
    return { slug: parts[1].toLowerCase() };
  if (
    parts[0] === "r" &&
    parts[1] === "p" &&
    parts[2] &&
    /^\d+$/.test(parts[2])
  )
    return { id: parts[2] };
  throw new PostRefError(
    `"${s}" is not a Product Hunt post URL (expected /posts/<slug> or /products/<slug>).`,
  );
}

export const refKey = (r: PostRef): string =>
  "id" in r ? `id:${r.id}` : `slug:${r.slug}`;

/** Topic slug from a slug, name or /topics/<slug> URL. */
export function parseTopic(s: string): string {
  let t = s.trim();
  const m = /producthunt\.com\/(?:topics|categories)\/([^/?#]+)/i.exec(t);
  if (m) t = m[1]!;
  t = t
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!t) throw new PostRefError(`"${s}" is not a topic slug.`);
  return t;
}

/** Product Hunt replaced most user data with "[REDACTED]" in its API. */
export function clean(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || /^\[?redacted\]?$/i.test(t)) return null;
  return t;
}
