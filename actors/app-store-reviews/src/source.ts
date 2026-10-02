import type { RawReview } from "./review.js";

export type Sort = "newest" | "mostRelevant";

export interface SourceQuery {
  /** ISO 3166 alpha-2, lower case. */
  country: string;
  /** ISO 639-1, lower case. */
  language: string;
  sort: Sort;
}

export interface AppInfo {
  /** Canonical ID used in requests and output. */
  id: string;
  name: string | null;
}

export interface ReviewSource {
  /** App metadata, or null if the app doesn't exist in this country. */
  resolve(id: string, q: SourceQuery): Promise<AppInfo | null>;
  /** Reviews in the requested sort order, fetched page by page on demand. */
  reviews(app: AppInfo, q: SourceQuery): AsyncGenerator<RawReview>;
}
