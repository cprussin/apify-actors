import type { DateWindow, NormalizedInput } from "./input.js";

export const API_BASE = "https://api.usaspending.gov";
export const PAGE_SIZE = 100; // API maximum for spending_by_award.

/** Fields requested from /api/v2/search/spending_by_award/ (contract awards). */
export const SEARCH_FIELDS = [
  "Award ID",
  "Recipient Name",
  "Recipient UEI",
  "Start Date",
  "End Date",
  "Award Amount",
  "Total Outlays",
  "Description",
  "Contract Award Type",
  "Awarding Agency",
  "Awarding Sub Agency",
  "NAICS",
  "PSC",
  "Primary Place of Performance",
  "Last Modified Date",
  "generated_internal_id",
] as const;

export interface LocationObject {
  location_country_code?: string | null;
  country_name?: string | null;
  state_code?: string | null;
  state_name?: string | null;
  city_name?: string | null;
  county_name?: string | null;
  zip5?: string | null;
}

export interface CodeObject {
  code?: string | null;
  description?: string | null;
}

/** One row of spending_by_award results for the fields above. */
export interface SearchRow {
  internal_id: number;
  generated_internal_id: string;
  "Award ID"?: string | null;
  "Recipient Name"?: string | null;
  "Recipient UEI"?: string | null;
  "Start Date"?: string | null;
  "End Date"?: string | null;
  "Award Amount"?: number | null;
  "Total Outlays"?: number | null;
  Description?: string | null;
  "Contract Award Type"?: string | null;
  "Awarding Agency"?: string | null;
  "Awarding Sub Agency"?: string | null;
  NAICS?: CodeObject | null;
  PSC?: CodeObject | null;
  "Primary Place of Performance"?: LocationObject | null;
  "Last Modified Date"?: string | null;
}

export interface PageMetadata {
  page: number;
  hasNext: boolean;
  last_record_unique_id?: number | null;
  last_record_sort_value?: string | null;
}

export interface SearchResponse {
  limit: number;
  results: SearchRow[];
  page_metadata: PageMetadata;
  messages?: string[];
}

/** Subset of GET /api/v2/awards/{id}/ for contracts. */
export interface AwardDetail {
  id: number;
  generated_unique_award_id: string;
  piid?: string | null;
  type?: string | null;
  type_description?: string | null;
  description?: string | null;
  total_obligation?: number | null;
  base_exercised_options?: number | null;
  base_and_all_options?: number | null;
  date_signed?: string | null;
  parent_award?: {
    piid?: string | null;
    generated_unique_award_id?: string | null;
    agency_name?: string | null;
  } | null;
  latest_transaction_contract_data?: {
    type_set_aside?: string | null;
    type_set_aside_description?: string | null;
    extent_competed?: string | null;
    extent_competed_description?: string | null;
    solicitation_identifier?: string | null;
    number_of_offers_received?: string | null;
    type_of_contract_pricing?: string | null;
    type_of_contract_pricing_description?: string | null;
    naics?: string | null;
    naics_description?: string | null;
    product_or_service_code?: string | null;
    product_or_service_description?: string | null;
  } | null;
  awarding_agency?: {
    toptier_agency?: { name?: string | null; code?: string | null } | null;
    subtier_agency?: { name?: string | null; code?: string | null } | null;
    office_agency_name?: string | null;
  } | null;
  period_of_performance?: {
    start_date?: string | null;
    end_date?: string | null;
    last_modified_date?: string | null;
    potential_end_date?: string | null;
  } | null;
  recipient?: {
    recipient_name?: string | null;
    recipient_uei?: string | null;
    parent_recipient_name?: string | null;
    parent_recipient_uei?: string | null;
    business_categories?: string[] | null;
  } | null;
  place_of_performance?: LocationObject | null;
}

/**
 * Cursor for sequential pagination. The API sorts by End Date then internal
 * award id and supports Elasticsearch `search_after` via these two values.
 */
export interface Cursor {
  sortValue: string;
  uniqueId: number;
}

export function buildFilters(input: NormalizedInput): Record<string, unknown> {
  const filters: Record<string, unknown> = {
    award_type_codes: input.awardTypes,
  };
  if (input.naicsCodes.length) filters.naics_codes = input.naicsCodes;
  if (input.pscCodes.length) filters.psc_codes = input.pscCodes;
  if (input.keywords.length) filters.keywords = input.keywords;
  if (input.setAsideTypes.length)
    filters.set_aside_type_codes = input.setAsideTypes;
  const agencies = [
    ...input.awardingAgencies.map((name) => ({
      type: "awarding",
      tier: "toptier",
      name,
    })),
    ...input.awardingSubAgencies.map((name) => ({
      type: "awarding",
      tier: "subtier",
      name,
    })),
  ];
  if (agencies.length) filters.agencies = agencies;
  if (input.placeOfPerformanceStates.length) {
    filters.place_of_performance_locations = input.placeOfPerformanceStates.map(
      (state) => ({ country: "USA", state }),
    );
  }
  if (input.minAwardValue !== undefined || input.maxAwardValue !== undefined) {
    const bound: Record<string, number> = {};
    if (input.minAwardValue !== undefined)
      bound.lower_bound = input.minAwardValue;
    if (input.maxAwardValue !== undefined)
      bound.upper_bound = input.maxAwardValue;
    filters.award_amounts = [bound];
  }
  return filters;
}

/**
 * Build the search body. With a cursor, results continue strictly after it
 * (search_after). The first request is seeded with the window start date and
 * unique id 0 so the scan starts at the first contract ending in the window
 * instead of in 2007.
 */
export function buildSearchBody(
  input: NormalizedInput,
  cursor: Cursor,
): Record<string, unknown> {
  return {
    filters: buildFilters(input),
    fields: SEARCH_FIELDS,
    sort: "End Date",
    order: "asc",
    limit: PAGE_SIZE,
    page: 1,
    subawards: false,
    last_record_sort_value: cursor.sortValue,
    last_record_unique_id: cursor.uniqueId,
  };
}

export const initialCursor = (window: DateWindow): Cursor => ({
  sortValue: window.start,
  uniqueId: 0,
});

/**
 * The API echoes the Elasticsearch sort value, which for date fields is epoch
 * milliseconds (e.g. "1790812800000"). The index parses search_after strings
 * with its `yyyy-MM-dd` format, so convert back before reusing it.
 */
export function normalizeSortValue(v: string | number): string {
  const s = String(v).trim();
  if (/^-?\d{9,}$/.test(s)) {
    return new Date(Number(s)).toISOString().slice(0, 10);
  }
  return s.slice(0, 10);
}

export function nextCursor(meta: PageMetadata): Cursor | null {
  if (!meta.hasNext) return null;
  const { last_record_sort_value: v, last_record_unique_id: id } = meta;
  if (v === undefined || v === null || v === "None" || id == null) return null;
  return { sortValue: normalizeSortValue(v), uniqueId: Number(id) };
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly url: string,
  ) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 300)}`);
  }
}

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface ClientOptions {
  fetch?: FetchLike;
  baseUrl?: string;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export class UsaSpendingClient {
  private readonly fetch: FetchLike;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (msg: string) => void;

  constructor(opts: ClientOptions = {}) {
    this.fetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.baseUrl = opts.baseUrl ?? API_BASE;
    this.maxRetries = opts.maxRetries ?? 5;
    this.baseDelayMs = opts.baseDelayMs ?? 1000;
    this.maxDelayMs = opts.maxDelayMs ?? 30_000;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.sleep =
      opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.log = opts.log ?? (() => {});
  }

  async request<T>(path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let attempt = 0;
    for (;;) {
      let retryAfterMs: number | undefined;
      let error: Error;
      try {
        const res = await this.fetch(url, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            accept: "application/json",
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
            "user-agent": "federal-recompete-radar (Apify actor)",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const text = await res.text();
        if (res.ok) return JSON.parse(text) as T;
        error = new HttpError(res.status, text, url);
        if (!RETRYABLE.has(res.status)) throw error;
        const ra = res.headers.get("retry-after");
        if (ra && Number.isFinite(Number(ra))) retryAfterMs = Number(ra) * 1000;
      } catch (e) {
        if (e instanceof HttpError && !RETRYABLE.has(e.status)) throw e;
        error = e instanceof Error ? e : new Error(String(e));
      }
      if (attempt >= this.maxRetries) throw error;
      const backoff = Math.min(
        this.maxDelayMs,
        this.baseDelayMs * 2 ** attempt * (0.75 + Math.random() * 0.5),
      );
      const delay = Math.min(this.maxDelayMs, retryAfterMs ?? backoff);
      attempt += 1;
      this.log(
        `Request failed (${error.message.slice(0, 120)}); retry ${attempt}/${this.maxRetries} in ${Math.round(delay)}ms`,
      );
      await this.sleep(delay);
    }
  }

  searchContracts(body: Record<string, unknown>): Promise<SearchResponse> {
    return this.request<SearchResponse>(
      "/api/v2/search/spending_by_award/",
      body,
    );
  }

  getAward(generatedId: string): Promise<AwardDetail> {
    return this.request<AwardDetail>(
      `/api/v2/awards/${encodeURIComponent(generatedId)}/`,
    );
  }
}
