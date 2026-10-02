/**
 * Trustpilot review pages are Next.js pages: everything we need is in the
 * `__NEXT_DATA__` JSON blob, so no DOM selectors are involved.
 */

export const BASE_URL = "https://www.trustpilot.com";

export interface TpConsumer {
  id?: string;
  displayName?: string;
  numberOfReviews?: number;
  countryCode?: string | null;
  isVerified?: boolean;
}

export interface TpReview {
  id: string;
  title?: string | null;
  text?: string | null;
  rating?: number;
  language?: string | null;
  likes?: number;
  source?: string | null;
  isPending?: boolean;
  dates?: {
    experiencedDate?: string | null;
    publishedDate?: string | null;
    updatedDate?: string | null;
  };
  labels?: {
    verification?: {
      isVerified?: boolean;
      verificationSource?: string | null;
      verificationLevel?: string | null;
    } | null;
  } | null;
  consumer?: TpConsumer | null;
  reply?: {
    message?: string | null;
    publishedDate?: string | null;
    updatedDate?: string | null;
  } | null;
}

export interface TpBusinessUnit {
  id: string;
  displayName?: string;
  identifyingName: string;
  numberOfReviews?: number;
  trustScore?: number;
  stars?: number;
  websiteUrl?: string | null;
  isClaimed?: boolean;
  isClosed?: boolean;
  countryCode?: string | null;
  categories?: { id?: string; name?: string; isPrimary?: boolean }[];
  contactInfo?: {
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
    country?: string | null;
    zipCode?: string | null;
  } | null;
  activity?: {
    replyBehavior?: {
      averageDaysToReply?: number | null;
      replyPercentage?: number | null;
    } | null;
  } | null;
}

export interface TpPagination {
  currentPage: number;
  perPage: number;
  totalCount: number;
  totalPages: number;
}

export interface TpFilters {
  totalNumberOfReviews?: number;
  totalNumberOfFilteredReviews?: number;
  pagination?: TpPagination;
  reviewStatistics?: {
    ratings?: Record<string, number>;
  };
}

export type ParsedPage =
  | {
      kind: "reviews";
      businessUnit: TpBusinessUnit;
      reviews: TpReview[];
      filters: TpFilters;
    }
  /** No such business on Trustpilot. */
  | { kind: "notFound" }
  /** Trustpilot redirects logged-out visitors past page 10 to a login page. */
  | { kind: "loginWall" }
  | { kind: "unknown"; detail: string };

export class ParseError extends Error {}

const NEXT_DATA_RE = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

export function extractNextData(html: string): unknown {
  const m = html.match(NEXT_DATA_RE);
  if (!m) throw new ParseError("No __NEXT_DATA__ script in page.");
  try {
    return JSON.parse(m[1]!) as unknown;
  } catch (e) {
    throw new ParseError(`Invalid __NEXT_DATA__ JSON: ${(e as Error).message}`);
  }
}

export function parseReviewPage(html: string): ParsedPage {
  const data = extractNextData(html) as {
    page?: string;
    props?: { pageProps?: Record<string, unknown> };
  };
  const pp = data.props?.pageProps ?? {};
  if (data.page === "/users/connect") return { kind: "loginWall" };
  if (data.page === "/_error" || pp.statusCode === 404) {
    return { kind: "notFound" };
  }
  const bu = pp.businessUnit as TpBusinessUnit | undefined;
  if (!bu?.identifyingName || !Array.isArray(pp.reviews)) {
    return {
      kind: "unknown",
      detail: `page=${data.page} keys=${Object.keys(pp).slice(0, 10).join(",")}`,
    };
  }
  return {
    kind: "reviews",
    businessUnit: bu,
    reviews: pp.reviews as TpReview[],
    filters: (pp.filters ?? {}) as TpFilters,
  };
}

/** AWS WAF interstitial ("Verifying your connection..."). */
export function isWafChallenge(
  status: number,
  body: string,
  wafHeader?: string | null,
): boolean {
  if (wafHeader && /challenge|captcha/i.test(wafHeader)) return true;
  return (
    (status === 202 || status === 403 || status === 405) &&
    /awswaf|Verifying Connection/i.test(body.slice(0, 5000))
  );
}

export const DEFAULT_CHALLENGE_URL =
  "https://a7d575be72e8.edge.sdk.awswaf.com/a7d575be72e8/b5180ee838be/challenge.js";

export function challengeScriptUrl(body: string): string | undefined {
  return body.match(/src="(https:\/\/[^"]+\.awswaf\.com\/[^"]+\.js)"/)?.[1];
}

export interface PageQuery {
  page?: number;
  stars?: number[];
  language: string;
  sort: "recency" | "relevance";
}

export function reviewPageUrl(company: string, q: PageQuery): string {
  const params = new URLSearchParams();
  if (q.language) params.set("languages", q.language);
  if (q.page && q.page > 1) params.set("page", String(q.page));
  if (q.sort === "recency") params.set("sort", "recency");
  for (const s of q.stars ?? []) params.append("stars", String(s));
  const qs = params.toString();
  return `${BASE_URL}/review/${encodeURIComponent(company)}${qs ? `?${qs}` : ""}`;
}
