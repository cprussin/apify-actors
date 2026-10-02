import { BlockedError, isChallenge, ParseError } from "./challenge.js";
import { productUrl } from "./search.js";

export const REVIEW_PAGE_SIZE = 20;

export interface Review {
  type: "review";
  productId: string;
  productTitle: string | null;
  reviewId: string;
  rating: number | null;
  text: string;
  translatedText: string | null;
  date: string | null;
  dateText: string | null;
  buyerName: string | null;
  buyerCountry: string | null;
  skuInfo: string | null;
  images: string[];
  helpfulCount: number;
  unhelpfulCount: number;
  additionalFeedback: string | null;
  additionalFeedbackDate: string | null;
  additionalImages: string[];
  logistics: string | null;
  productUrl: string;
  scrapedAt: string;
}

export interface ReviewPage {
  reviews: Omit<Review, "productTitle" | "scrapedAt">[];
  page: number;
  totalPages: number;
  totalReviews: number;
  averageRating: number | null;
}

/** ISO 639-1 → AliExpress locale for the `lang` parameter. */
const LOCALES: Record<string, string> = {
  en: "en_US",
  de: "de_DE",
  fr: "fr_FR",
  es: "es_ES",
  it: "it_IT",
  pt: "pt_BR",
  nl: "nl_NL",
  pl: "pl_PL",
  ru: "ru_RU",
  tr: "tr_TR",
  ja: "ja_JP",
  ko: "ko_KR",
  ar: "ar_MA",
  he: "iw_IL",
  th: "th_TH",
  vi: "vi_VN",
  id: "in_ID",
  uk: "uk_UA",
};

export const localeFor = (language: string): string =>
  LOCALES[language] ?? "en_US";

export function reviewsUrl(
  productId: string,
  page: number,
  opts: { translateTo?: string } = {},
): string {
  const u = new URL("https://feedback.aliexpress.com/pc/searchEvaluation.do");
  u.searchParams.set("productId", productId);
  u.searchParams.set("page", String(page));
  u.searchParams.set("pageSize", String(REVIEW_PAGE_SIZE));
  u.searchParams.set("filter", "all");
  if (opts.translateTo) {
    u.searchParams.set("lang", localeFor(opts.translateTo));
    u.searchParams.set("translate", "Y");
  }
  return u.toString();
}

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/** "28 Oct 2025" → "2025-10-28". Null for other (localized) formats. */
export function parseReviewDate(s: string | null): string | null {
  if (!s) return null;
  const m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/.exec(s.trim());
  if (m) {
    const month = MONTHS[m[2]!.toLowerCase()];
    if (month !== undefined) {
      const d = new Date(Date.UTC(Number(m[3]), month, Number(m[1])));
      return d.toISOString().slice(0, 10);
    }
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** For "is the translation just the original?" comparisons. */
const squash = (s: string): string =>
  s.toLowerCase().replace(/[\s\p{P}]+/gu, "");
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** Parses one searchEvaluation.do response. Throws BlockedError on bot checks. */
export function parseReviewPage(body: string, productId: string): ReviewPage {
  let json: Obj;
  try {
    json = obj(JSON.parse(body));
  } catch {
    if (isChallenge(body) || /^\s*</.test(body))
      throw new BlockedError("AliExpress returned a bot-check page.");
    throw new ParseError(`Unexpected reviews response: ${body.slice(0, 120)}`);
  }
  const data = obj(json.data);
  if (!Array.isArray(data.evaViewList)) {
    if (isChallenge(body))
      throw new BlockedError("AliExpress returned a bot-check response.");
    throw new ParseError(`Unexpected reviews response: ${body.slice(0, 120)}`);
  }
  const helpful = obj(json.helpful);
  const list = data.evaViewList as unknown[];
  const stats = obj(data.productEvaluationStatistic);

  const reviews: ReviewPage["reviews"] = [];
  for (const raw of list) {
    const r = obj(raw);
    const reviewId =
      str(r.evaluationIdStr) ?? str(String(r.evaluationId ?? ""));
    if (!reviewId) continue;
    const text = str(r.buyerFeedback) ?? "";
    const translated = str(r.buyerTranslationFeedback);
    const evalScore = num(r.buyerEval);
    const h = obj(helpful[reviewId]);
    const dateText = str(r.evalDate);
    const addDate = str(r.buyerAddFbDate);
    reviews.push({
      type: "review",
      productId,
      reviewId,
      rating:
        evalScore === null
          ? null
          : Math.min(5, Math.max(1, Math.round(evalScore / 20))),
      text,
      translatedText:
        translated && squash(translated) !== squash(text) ? translated : null,
      date: parseReviewDate(dateText),
      dateText,
      buyerName: str(r.buyerName),
      buyerCountry: str(r.buyerCountry),
      skuInfo: str(r.skuInfo),
      images: strings(r.images),
      helpfulCount: num(h.useful) ?? num(r.upVoteCount) ?? 0,
      unhelpfulCount: num(h.useless) ?? num(r.downVoteCount) ?? 0,
      additionalFeedback: str(r.buyerAddFbContent),
      additionalFeedbackDate: parseReviewDate(addDate) ?? addDate,
      additionalImages: strings(r.buyerAddFbImages),
      logistics: str(r.logistics),
      productUrl: productUrl(productId),
    });
  }
  const avg = num(stats.evarageStar);
  return {
    reviews,
    page: num(data.currentPage) ?? 1,
    totalPages: num(data.totalPage) ?? 0,
    totalReviews: num(data.totalNum) ?? num(stats.totalNum) ?? 0,
    averageRating: avg && avg > 0 ? avg : null,
  };
}
