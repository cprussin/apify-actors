import { BASE_URL, type TpBusinessUnit, type TpReview } from "./page.js";

export interface CompanyInfo {
  trustpilotId: string;
  websiteUrl: string | null;
  stars: number | null;
  isClaimed: boolean | null;
  isClosed: boolean | null;
  country: string | null;
  categories: string[];
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  zipCode: string | null;
  replyPercentage: number | null;
  averageDaysToReply: number | null;
  /** Review counts by star rating ("1".."5"). */
  ratingDistribution: Record<string, number> | null;
  profileUrl: string;
}

export interface ReviewRecord {
  companyDomain: string;
  companyName: string | null;
  trustScore: number | null;
  totalReviews: number | null;
  reviewId: string;
  rating: number | null;
  title: string | null;
  text: string | null;
  author: string | null;
  authorCountry: string | null;
  authorReviewCount: number | null;
  /** Publication timestamp (ISO 8601). */
  date: string | null;
  /** Date of experience (YYYY-MM-DD). */
  experienceDate: string | null;
  updatedDate: string | null;
  /** Trustpilot "Verified" label (invited or otherwise verified review). */
  verified: boolean;
  verificationSource: string | null;
  companyReply: string | null;
  companyReplyDate: string | null;
  language: string | null;
  likes: number | null;
  url: string;
  company?: CompanyInfo;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const bool = (v: unknown): boolean | null =>
  typeof v === "boolean" ? v : null;

export const profileUrl = (identifyingName: string): string =>
  `${BASE_URL}/review/${identifyingName}`;

const RATING_KEYS: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
};

export function toCompanyInfo(
  bu: TpBusinessUnit,
  ratings?: Record<string, number>,
): CompanyInfo {
  const c = bu.contactInfo ?? {};
  const rb = bu.activity?.replyBehavior ?? {};
  let dist: Record<string, number> | null = null;
  if (ratings) {
    dist = {};
    for (const [k, v] of Object.entries(ratings)) {
      if (RATING_KEYS[k] && typeof v === "number") dist[RATING_KEYS[k]] = v;
    }
  }
  return {
    trustpilotId: bu.id,
    websiteUrl: str(bu.websiteUrl),
    stars: num(bu.stars),
    isClaimed: bool(bu.isClaimed),
    isClosed: bool(bu.isClosed),
    country: str(bu.countryCode) ?? str(c.country),
    categories: (bu.categories ?? [])
      .map((x) => str(x.name))
      .filter((x): x is string => x !== null),
    email: str(c.email),
    phone: str(c.phone),
    address: str(c.address),
    city: str(c.city),
    zipCode: str(c.zipCode),
    replyPercentage: num(rb.replyPercentage),
    averageDaysToReply: num(rb.averageDaysToReply),
    ratingDistribution: dist,
    profileUrl: profileUrl(bu.identifyingName),
  };
}

export function toRecord(
  r: TpReview,
  bu: TpBusinessUnit,
  company?: CompanyInfo,
): ReviewRecord {
  const v = r.labels?.verification;
  const rec: ReviewRecord = {
    companyDomain: bu.identifyingName,
    companyName: str(bu.displayName),
    trustScore: num(bu.trustScore),
    totalReviews: num(bu.numberOfReviews),
    reviewId: r.id,
    rating: num(r.rating),
    title: str(r.title),
    text: str(r.text),
    author: str(r.consumer?.displayName),
    authorCountry: str(r.consumer?.countryCode),
    authorReviewCount: num(r.consumer?.numberOfReviews),
    date: str(r.dates?.publishedDate),
    experienceDate: str(r.dates?.experiencedDate)?.slice(0, 10) ?? null,
    updatedDate: str(r.dates?.updatedDate),
    verified: v?.isVerified === true,
    verificationSource: str(v?.verificationSource),
    companyReply: str(r.reply?.message),
    companyReplyDate: str(r.reply?.publishedDate),
    language: str(r.language),
    likes: num(r.likes),
    url: `${BASE_URL}/reviews/${r.id}`,
  };
  if (company) rec.company = company;
  return rec;
}
