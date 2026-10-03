import type { AlgoliaOpts, RawCompany } from "./yc.js";
import { COMPANY_ATTRIBUTES } from "./yc.js";

export const INDEX = "YCCompany_production";
/** Replica sorted by launch date, newest first (same restricted key). */
export const INDEX_BY_LAUNCH = "YCCompany_By_Launch_Date_production";
/** Algolia never returns hits past this position for one query. */
export const PAGINATION_LIMIT = 1000;
export const MAX_HITS_PER_PAGE = 1000;

export interface SearchParams {
  query?: string;
  /** AND of ORs, e.g. [["batch:Summer 2025"], ["isHiring:true"]]. */
  facetFilters?: string[][];
  numericFilters?: string[];
  hitsPerPage?: number;
  page?: number;
  facets?: string[];
  attributesToRetrieve?: string[];
}

export interface SearchResult {
  hits: RawCompany[];
  nbHits: number;
  nbPages: number;
  page: number;
  facets?: Record<string, Record<string, number>>;
  message?: string;
}

export type PostJson = (
  url: string,
  body: string,
  headers: Record<string, string>,
) => Promise<{ html: string }>;

export function encodeParams(p: SearchParams): string {
  const q = new URLSearchParams();
  q.set("query", p.query ?? "");
  q.set("hitsPerPage", String(p.hitsPerPage ?? 20));
  q.set("page", String(p.page ?? 0));
  if (p.facetFilters?.length)
    q.set("facetFilters", JSON.stringify(p.facetFilters));
  if (p.numericFilters?.length)
    q.set("numericFilters", JSON.stringify(p.numericFilters));
  if (p.facets?.length) {
    q.set("facets", JSON.stringify(p.facets));
    q.set("maxValuesPerFacet", "1000");
  }
  q.set(
    "attributesToRetrieve",
    JSON.stringify(p.attributesToRetrieve ?? COMPANY_ATTRIBUTES),
  );
  q.set("attributesToHighlight", "[]");
  q.set("attributesToSnippet", "[]");
  return q.toString();
}

/** Search-only client for the public YC company index. */
export class AlgoliaSearch {
  requests = 0;
  constructor(
    private readonly opts: AlgoliaOpts,
    private readonly post: PostJson,
  ) {}

  get url(): string {
    return `https://${this.opts.app.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries`;
  }

  async search(p: SearchParams, index = INDEX): Promise<SearchResult> {
    this.requests += 1;
    const body = JSON.stringify({
      requests: [{ indexName: index, params: encodeParams(p) }],
    });
    const res = await this.post(this.url, body, {
      accept: "application/json",
      "content-type": "application/json",
      "x-algolia-application-id": this.opts.app,
      "x-algolia-api-key": this.opts.key,
    });
    let json: { results?: SearchResult[]; message?: string };
    try {
      json = JSON.parse(res.html) as typeof json;
    } catch {
      throw new Error(`Algolia returned non-JSON: ${res.html.slice(0, 160)}`);
    }
    const r = json.results?.[0];
    if (!r) throw new Error(`Algolia error: ${json.message ?? "no results"}`);
    return { ...r, hits: r.hits ?? [] };
  }
}
