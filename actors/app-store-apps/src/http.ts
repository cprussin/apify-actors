// Copied from actors/app-store-reviews/src/http.ts (actors are self-contained
// Docker builds, so they can't import each other), plus per-host throttling.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly url: string,
  ) {
    super(`HTTP ${status} from ${url.slice(0, 200)}: ${body.slice(0, 200)}`);
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

export interface HttpOptions {
  fetch?: FetchLike;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  /** Minimum gap between requests to the same host, in ms. */
  minIntervalMs?: Record<string, number>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (msg: string) => void;
}

export interface Request {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

/** A response we deliberately don't retry, e.g. 404 for an unknown app. */
export interface HttpResult {
  status: number;
  text: string;
}

// Apple's Search API answers 403 when it rate-limits.
const RETRYABLE = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

/**
 * Polite defaults. Apple documents ~20 Search API calls per minute; the RSS
 * feeds and Google Play pages get a smaller gap.
 */
export const DEFAULT_INTERVALS: Record<string, number> = {
  "itunes.apple.com": 3000,
  "rss.marketingtools.apple.com": 1000,
  "play.google.com": 1500,
};

/**
 * Fetch with timeout, retries, exponential backoff, Retry-After support and
 * a minimum interval between requests to the same host.
 */
export class HttpClient {
  private readonly fetch: FetchLike;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly timeoutMs: number;
  private readonly intervals: Record<string, number>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  /** Earliest time the next request to each host may start. */
  private readonly nextSlot = new Map<string, number>();
  requests = 0;

  constructor(opts: HttpOptions = {}) {
    this.fetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.maxRetries = opts.maxRetries ?? 4;
    this.baseDelayMs = opts.baseDelayMs ?? 2000;
    this.maxDelayMs = opts.maxDelayMs ?? 30_000;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.intervals = opts.minIntervalMs ?? DEFAULT_INTERVALS;
    this.sleep =
      opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
  }

  private async throttle(url: string): Promise<void> {
    const host = new URL(url).hostname;
    const gap = this.intervals[host] ?? 0;
    if (!gap) return;
    const now = this.now();
    const slot = Math.max(now, this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, slot + gap);
    if (slot > now) await this.sleep(slot - now);
  }

  /**
   * Returns the body for 2xx, and also for any status in `accept` (so callers
   * can treat e.g. 404 as "not found"). Retries transient failures.
   */
  async request(req: Request, accept: number[] = []): Promise<HttpResult> {
    let attempt = 0;
    for (;;) {
      let retryAfterMs: number | undefined;
      let error: Error;
      try {
        await this.throttle(req.url);
        this.requests += 1;
        const res = await this.fetch(req.url, {
          method: req.method ?? "GET",
          headers: { "user-agent": USER_AGENT, ...req.headers },
          body: req.body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const text = await res.text();
        if (res.ok || accept.includes(res.status)) {
          return { status: res.status, text };
        }
        error = new HttpError(res.status, text, req.url);
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
