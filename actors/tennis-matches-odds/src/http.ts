export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} from ${url.slice(0, 200)}`);
  }
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
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
  /** Minimum gap between two requests (politeness). */
  minIntervalMs?: number;
  /** Extra random gap added to minIntervalMs. */
  jitterMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (msg: string) => void;
}

const RETRYABLE = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

/**
 * Sequential, polite fetch: one request at a time, ~1 req/s with jitter,
 * timeouts, retries with exponential backoff and Retry-After support.
 */
export class HttpClient {
  private readonly fetch: FetchLike;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;
  private readonly jitterMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private last = Number.NEGATIVE_INFINITY;
  private queue: Promise<unknown> = Promise.resolve();
  requests = 0;

  constructor(opts: HttpOptions = {}) {
    this.fetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.maxRetries = opts.maxRetries ?? 4;
    this.baseDelayMs = opts.baseDelayMs ?? 2000;
    this.maxDelayMs = opts.maxDelayMs ?? 30_000;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.minIntervalMs = opts.minIntervalMs ?? 1000;
    this.jitterMs = opts.jitterMs ?? 500;
    this.sleep =
      opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
  }

  /** GET a page. Returns null for 404 (not found). Serialized across callers. */
  get(url: string): Promise<string | null> {
    const p = this.queue.then(() => this.getNow(url));
    this.queue = p.catch(() => {});
    return p;
  }

  private async throttle(): Promise<void> {
    const gap = this.minIntervalMs + Math.random() * this.jitterMs;
    const wait = this.last + gap - this.now();
    if (wait > 0) await this.sleep(wait);
    this.last = this.now();
  }

  private async getNow(url: string): Promise<string | null> {
    let attempt = 0;
    for (;;) {
      let retryAfterMs: number | undefined;
      let error: Error;
      await this.throttle();
      try {
        this.requests += 1;
        const res = await this.fetch(url, {
          headers: {
            "user-agent": USER_AGENT,
            "accept-language": "en-US,en;q=0.9",
            accept: "text/html,application/xhtml+xml",
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const text = await res.text();
        if (res.ok) return text;
        if (res.status === 404) return null;
        error = new HttpError(res.status, url);
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
