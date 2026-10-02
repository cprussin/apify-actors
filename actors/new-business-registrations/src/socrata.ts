import type { Row } from "./record.js";

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
  /** Optional Socrata app token; raises rate limits. */
  appToken?: string;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

/** SODA 2.x query parameters. */
export interface SoqlQuery {
  select?: string;
  where?: string;
  order?: string;
  limit?: number;
  offset?: number;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Quote a string literal for SoQL. */
export const soqlString = (s: string): string => `'${s.replace(/'/g, "''")}'`;

export function resourceUrl(
  domain: string,
  datasetId: string,
  q: SoqlQuery = {},
): string {
  const params = new URLSearchParams();
  if (q.select) params.set("$select", q.select);
  if (q.where) params.set("$where", q.where);
  if (q.order) params.set("$order", q.order);
  if (q.limit !== undefined) params.set("$limit", String(q.limit));
  if (q.offset) params.set("$offset", String(q.offset));
  const qs = params.toString();
  return `https://${domain}/resource/${datasetId}.json${qs ? `?${qs}` : ""}`;
}

export class SocrataClient {
  private readonly fetch: FetchLike;
  private readonly appToken?: string;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (msg: string) => void;

  constructor(opts: ClientOptions = {}) {
    this.fetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.appToken = opts.appToken || undefined;
    this.maxRetries = opts.maxRetries ?? 4;
    this.baseDelayMs = opts.baseDelayMs ?? 1000;
    this.maxDelayMs = opts.maxDelayMs ?? 30_000;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.sleep =
      opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.log = opts.log ?? (() => {});
  }

  async query(domain: string, datasetId: string, q: SoqlQuery): Promise<Row[]> {
    const url = resourceUrl(domain, datasetId, q);
    let attempt = 0;
    for (;;) {
      let retryAfterMs: number | undefined;
      let error: Error;
      try {
        const res = await this.fetch(url, {
          method: "GET",
          headers: {
            accept: "application/json",
            "user-agent": "new-business-registrations (Apify actor)",
            ...(this.appToken ? { "x-app-token": this.appToken } : {}),
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const text = await res.text();
        if (res.ok) {
          const body = JSON.parse(text) as unknown;
          if (!Array.isArray(body)) {
            throw new HttpError(res.status, "Expected a JSON array", url);
          }
          return body as Row[];
        }
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
}
