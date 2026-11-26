import { isBlockPage } from "./wellfound.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly url: string,
  ) {
    super(`HTTP ${status} from ${url.slice(0, 160)}: ${body.slice(0, 160)}`);
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
  url?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export const USER_AGENT =
  "Mozilla/5.0 (compatible; wellfound-jobs/0.1; +https://apify.com/cprussin/wellfound-jobs)";

export const BLOCKED_MESSAGE = "Wellfound blocked this request (Cloudflare)";

/** A 403/429 or Cloudflare challenge page. Never retried. */
export class BlockedError extends HttpError {
  constructor(status: number, body: string, url: string) {
    super(status, body, url);
    this.message = `${BLOCKED_MESSAGE}: HTTP ${status} from ${url.slice(0, 160)}`;
  }
}

export interface ClientOptions {
  /** Transport (e.g. through a proxy). Default: global fetch. */
  fetch?: FetchLike;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Per-attempt timeout. Default 30 s. */
  timeoutMs?: number;
  /** Max total time for one request incl. retries. Default: unlimited. */
  maxRequestMs?: number;
  /**
   * Stop retrying once no request has succeeded for this long (dead
   * network/proxy): later requests get a single attempt until one succeeds.
   */
  maxFailingMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (msg: string) => void;
}

const BLOCKED = new Set([403, 429]);
const TRANSIENT = new Set([408, 500, 502, 503, 504]);

type Failure = "blocked" | "transient" | "fatal";

/** How to handle an error from one attempt. */
export function classify(e: unknown): Failure {
  if (e instanceof BlockedError) return "blocked";
  if (e instanceof HttpError) {
    if (BLOCKED.has(e.status)) return "blocked";
    if (TRANSIENT.has(e.status) || e.status >= 500) return "transient";
    return "fatal";
  }
  // Timeouts, connection resets, proxy errors, ...
  return "transient";
}

export interface Page {
  /** Final URL after redirects, when the transport reports it. */
  url: string;
  html: string;
}

/**
 * HTTP client for wellfound.com. Identifies itself with an honest
 * User-Agent, retries transient errors (timeouts, network errors, 5xx) with
 * backoff, and caps total retry time. A block (403/429 or a Cloudflare
 * challenge page) fails the request at once with a BlockedError: no retry,
 * no new IP.
 */
export class WellfoundClient {
  private readonly fetch: FetchLike;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly timeoutMs: number;
  private readonly maxRequestMs: number;
  private readonly maxFailingMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private lastSuccess: number;
  requests = 0;
  blocks = 0;
  errors = 0;

  constructor(opts: ClientOptions = {}) {
    this.fetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.maxRetries = opts.maxRetries ?? 5;
    this.baseDelayMs = opts.baseDelayMs ?? 1500;
    this.maxDelayMs = opts.maxDelayMs ?? 20_000;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxRequestMs = opts.maxRequestMs ?? Infinity;
    this.maxFailingMs = opts.maxFailingMs ?? Infinity;
    this.sleep =
      opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    this.lastSuccess = this.now();
  }

  private async send(url: string, timeoutMs: number): Promise<Page> {
    this.requests += 1;
    const res = await this.fetch(url, {
      method: "GET",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html",
        "accept-language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const html = await res.text();
    if (
      BLOCKED.has(res.status) ||
      res.headers.get("cf-mitigated") === "challenge" ||
      isBlockPage(html)
    )
      throw new BlockedError(res.status, html, url);
    if (!res.ok) throw new HttpError(res.status, html, url);
    return { url: res.url || url, html };
  }

  /** Returns the final URL and body of a 2xx response; throws HttpError otherwise. */
  async get(url: string): Promise<Page> {
    const deadline = this.now() + this.maxRequestMs;
    let attempt = 0;
    for (;;) {
      let error: Error;
      try {
        const timeoutMs = Math.max(
          1000,
          Math.min(this.timeoutMs, deadline - this.now()),
        );
        const page = await this.send(url, timeoutMs);
        this.lastSuccess = this.now();
        return page;
      } catch (e) {
        error = e instanceof Error ? e : new Error(String(e));
      }
      const kind = classify(error);
      if (kind === "blocked") {
        this.blocks += 1;
        throw error;
      }
      if (kind === "fatal") throw error;
      this.errors += 1;
      const delay = Math.min(
        this.maxDelayMs,
        this.baseDelayMs * 2 ** attempt * (0.75 + Math.random() * 0.5),
      );
      const now = this.now();
      if (attempt >= this.maxRetries) throw error;
      if (now + delay >= deadline) {
        this.log(`Giving up on request after ${attempt + 1} attempts.`);
        throw error;
      }
      if (now - this.lastSuccess >= this.maxFailingMs) {
        this.log(
          `No successful request for ${Math.round((now - this.lastSuccess) / 1000)}s; not retrying.`,
        );
        throw error;
      }
      attempt += 1;
      this.log(
        `Request failed (${error.message.slice(0, 120)}); retry ${attempt}/${this.maxRetries} in ${Math.round(delay)}ms`,
      );
      await this.sleep(delay);
    }
  }
}
