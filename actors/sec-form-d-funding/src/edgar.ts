import { filingUrls, stripCik, type FilingRef } from "./formd.js";

export const SEARCH_BASE = "https://efts.sec.gov/LATEST/search-index";
/** EFTS page size (fixed by the API). */
export const PAGE_SIZE = 100;
/** EFTS refuses offsets beyond its 10,000-hit result window. */
export const MAX_OFFSET = 10_000;
/**
 * Declared User-Agent per the SEC's fair-access policy
 * (https://www.sec.gov/os/accessing-edgar-data). Override with SEC_USER_AGENT.
 */
export const DEFAULT_USER_AGENT =
  "sec-form-d-funding/0.1 (Apify actor; +https://apify.com/cprussin/sec-form-d-funding)";
/** SEC allows 10 requests/second; stay a little below. */
export const MIN_INTERVAL_MS = 125;

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    body: string,
    readonly url: string,
  ) {
    super(
      status === 403
        ? `HTTP 403 from ${url}: SEC refused the request (User-Agent or rate limit).`
        : `HTTP ${status} from ${url}: ${body.slice(0, 200)}`,
    );
  }
}

export interface SearchHit {
  _id: string;
  _source: {
    ciks?: string[];
    adsh?: string;
    form?: string;
    root_forms?: string[];
    file_date?: string;
    biz_states?: string[];
    display_names?: string[];
  };
}

export interface SearchResponse {
  hits: { total?: { value: number }; hits: SearchHit[] };
}

export interface SearchParams {
  /** Filing date (YYYY-MM-DD); one day per query keeps under 10,000 hits. */
  date: string;
  /** EFTS `forms` value: "D" (new + amendments) or "D/A". */
  forms: "D" | "D/A";
  /** Business-address state codes (EFTS `locationCodes`). */
  states: string[];
  from: number;
}

export function searchUrl(p: SearchParams): string {
  const q = new URLSearchParams({
    forms: p.forms,
    dateRange: "custom",
    startdt: p.date,
    enddt: p.date,
  });
  if (p.states.length) q.set("locationCodes", p.states.join(","));
  if (p.from) q.set("from", String(p.from));
  return `${SEARCH_BASE}?${q}`;
}

/** Map a search hit to a filing reference (null for non-Form D documents). */
export function toFilingRef(hit: SearchHit): FilingRef | null {
  const s = hit._source;
  const adsh = s.adsh ?? hit._id.split(":")[0];
  const cik = s.ciks?.[0];
  if (!adsh || !cik || !/^\d{10}-\d{2}-\d{6}$/.test(adsh)) return null;
  if (!hit._id.endsWith(":primary_doc.xml")) return null;
  return {
    accessionNumber: adsh,
    cik: stripCik(cik),
    formType: s.form ?? "D",
    filingDate: s.file_date ?? null,
  };
}

export interface ClientOptions {
  fetch?: FetchLike;
  userAgent?: string;
  minIntervalMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (msg: string) => void;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

/** EDGAR client: global rate limit, retries with backoff on 429/5xx. */
export class EdgarClient {
  private readonly fetch: FetchLike;
  private readonly userAgent: string;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private nextSlot = 0;
  requests = 0;

  constructor(opts: ClientOptions = {}) {
    this.fetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.userAgent = opts.userAgent || DEFAULT_USER_AGENT;
    this.minIntervalMs = opts.minIntervalMs ?? MIN_INTERVAL_MS;
    this.maxRetries = opts.maxRetries ?? 5;
    this.baseDelayMs = opts.baseDelayMs ?? 1000;
    this.maxDelayMs = opts.maxDelayMs ?? 60_000;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.sleep =
      opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
  }

  /** Wait for the next request slot (shared by concurrent callers). */
  private async throttle(): Promise<void> {
    const now = this.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.minIntervalMs;
    if (slot > now) await this.sleep(slot - now);
  }

  async get(url: string, accept: string): Promise<string> {
    let attempt = 0;
    for (;;) {
      await this.throttle();
      this.requests += 1;
      let retryAfterMs: number | undefined;
      let error: Error;
      try {
        const res = await this.fetch(url, {
          headers: { accept, "user-agent": this.userAgent },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const body = await res.text();
        if (res.ok) return body;
        error = new HttpError(res.status, body, url);
        if (!RETRYABLE.has(res.status)) throw error;
        const ra = Number(res.headers.get("retry-after"));
        if (ra > 0) retryAfterMs = ra * 1000;
      } catch (e) {
        if (e instanceof HttpError && !RETRYABLE.has(e.status)) throw e;
        error = e instanceof Error ? e : new Error(String(e));
      }
      if (attempt >= this.maxRetries) throw error;
      const backoff =
        this.baseDelayMs * 2 ** attempt * (0.75 + Math.random() * 0.5);
      const delay = Math.min(this.maxDelayMs, retryAfterMs ?? backoff);
      attempt += 1;
      // Back off every concurrent caller, not just this one.
      this.nextSlot = Math.max(this.nextSlot, this.now() + delay);
      this.log(
        `Request failed (${error.message.slice(0, 120)}); retry ${attempt}/${this.maxRetries} in ${Math.round(delay)}ms`,
      );
      await this.sleep(delay);
    }
  }

  async search(p: SearchParams): Promise<SearchResponse> {
    const body = await this.get(searchUrl(p), "application/json");
    const res = JSON.parse(body) as SearchResponse;
    if (!res?.hits || !Array.isArray(res.hits.hits)) {
      throw new Error(
        `Unexpected EDGAR search response: ${body.slice(0, 200)}`,
      );
    }
    return res;
  }

  primaryDoc(ref: FilingRef): Promise<string> {
    return this.get(filingUrls(ref).xmlUrl, "application/xml,text/xml");
  }
}
