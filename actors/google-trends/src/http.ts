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
  headers: {
    get(name: string): string | null;
    getSetCookie?: () => string[];
  };
  text(): Promise<string>;
}>;

export interface ClientOptions {
  /** Primary transport (e.g. through a proxy). Default: global fetch. */
  fetch?: FetchLike;
  /**
   * Alternative transport (e.g. direct, no proxy). Used after
   * `fallbackAfter` consecutive network errors/timeouts/5xx on `fetch`;
   * a block (429/403/captcha) on it switches back to `fetch`.
   */
  fallbackFetch?: FetchLike;
  /** Consecutive primary failures before switching to `fallbackFetch`. Default 2. */
  fallbackAfter?: number;
  /** Switch to a new proxy session (new IP). Called after every failed attempt. */
  rotate?: () => void;
  /**
   * Delay before retrying when `rotate` gives a new IP (no need to wait out
   * the old IP's rate limit). Default: normal backoff.
   */
  rotatedDelayMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Per-attempt timeout. Default 15 s. */
  timeoutMs?: number;
  /** Max total time for one request incl. retries. Default: unlimited. */
  maxRequestMs?: number;
  /**
   * Stop retrying once no request has succeeded for this long (dead
   * network/proxy): later requests get a single attempt until one succeeds.
   * Default: unlimited.
   */
  maxFailingMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (msg: string) => void;
}

export const BASE = "https://trends.google.com";
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

/** Statuses Google uses for rate limiting / bot blocks, plus transient errors. */
const BLOCKED = new Set([403, 429]);
const TRANSIENT = new Set([408, 500, 502, 503, 504]);

/** Google's "unusual traffic" captcha page (may come with a 200 after redirects). */
export function isCaptcha(url: string | undefined, body: string): boolean {
  return (
    (url ?? "").includes("/sorry/") ||
    /google\.com\/sorry\/|detected unusual traffic|id="captcha-form"/i.test(
      body.slice(0, 20_000),
    )
  );
}

type Failure = "blocked" | "transient" | "fatal";

/** How to handle an error from one attempt. */
export function classify(e: unknown): Failure {
  if (e instanceof HttpError) {
    if (BLOCKED.has(e.status)) return "blocked";
    if (TRANSIENT.has(e.status) || e.status >= 500) return "transient";
    return "fatal";
  }
  // Timeouts, connection resets, proxy errors, ...
  return "transient";
}

/** Extract "name=value" pairs from Set-Cookie headers. */
export function parseSetCookie(headers: {
  get(name: string): string | null;
  getSetCookie?: () => string[];
}): string {
  const list =
    headers.getSetCookie?.() ??
    (headers.get("set-cookie") ?? "").split(/,(?=\s*[A-Za-z0-9_-]+=)/);
  return list
    .map((c) => c.split(";")[0]!.trim())
    .filter((c) => /^[A-Za-z0-9_-]+=/.test(c))
    .join("; ");
}

/**
 * HTTP client for trends.google.com: gets an NID cookie first, retries blocks
 * (429/403/captcha) and transient errors (timeouts, network errors, 5xx) with
 * a new proxy session each time, falls back to `fallbackFetch` when the
 * primary transport keeps failing, and caps total retry time.
 */
export class TrendsClient {
  private readonly primary: FetchLike;
  private readonly fallback: FetchLike | undefined;
  private readonly fallbackAfter: number;
  private readonly rotate: () => void;
  private readonly rotatedDelayMs: number | undefined;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly timeoutMs: number;
  private readonly maxRequestMs: number;
  private readonly maxFailingMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private cookie: string | undefined;
  private onFallback = false;
  private primaryFailures = 0;
  private lastSuccess: number;
  requests = 0;
  blocks = 0;
  errors = 0;

  constructor(opts: ClientOptions = {}) {
    this.primary = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.fallback = opts.fallbackFetch;
    this.fallbackAfter = opts.fallbackAfter ?? 2;
    this.rotate = opts.rotate ?? (() => {});
    this.rotatedDelayMs = opts.rotatedDelayMs;
    this.maxRetries = opts.maxRetries ?? 5;
    this.baseDelayMs = opts.baseDelayMs ?? 1500;
    this.maxDelayMs = opts.maxDelayMs ?? 20_000;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.maxRequestMs = opts.maxRequestMs ?? Infinity;
    this.maxFailingMs = opts.maxFailingMs ?? Infinity;
    this.sleep =
      opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    this.lastSuccess = this.now();
  }

  /** "fallback" while requests go through `fallbackFetch`. */
  get route(): "primary" | "fallback" {
    return this.onFallback ? "fallback" : "primary";
  }

  private async send(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string },
    timeoutMs: number,
  ) {
    this.requests += 1;
    const fetch = this.onFallback ? this.fallback! : this.primary;
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        "user-agent": USER_AGENT,
        "accept-language": "en-US,en;q=0.9",
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...init.headers,
      },
      body: init.body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (isCaptcha(res.url, text)) throw new HttpError(429, "captcha", url);
    return { res, text };
  }

  /** Visit the Trends home page once per session to get an NID cookie. */
  private async ensureCookie(timeoutMs: number): Promise<void> {
    if (this.cookie !== undefined) return;
    const { res } = await this.send(`${BASE}/trends/?geo=US`, {}, timeoutMs);
    if (BLOCKED.has(res.status) || res.status >= 500)
      throw new HttpError(res.status, "", BASE);
    this.cookie = parseSetCookie(res.headers);
  }

  /** Update route after a failed attempt; returns a note for the log. */
  private switchRoute(kind: Failure): string {
    if (!this.fallback) return "";
    if (this.onFallback) {
      // Fallback (direct) is blocked or broken: back to the (new) proxy IP.
      this.onFallback = false;
      this.primaryFailures = 0;
      return "back to proxy, ";
    }
    if (kind === "transient") this.primaryFailures += 1;
    if (this.primaryFailures >= this.fallbackAfter) {
      this.onFallback = true;
      return "proxy failing, trying direct, ";
    }
    return "";
  }

  /** Returns the body of a 2xx response; throws HttpError otherwise. */
  async request(
    url: string,
    init: {
      method?: "GET" | "POST";
      headers?: Record<string, string>;
      body?: string;
    } = {},
  ): Promise<string> {
    const deadline = this.now() + this.maxRequestMs;
    let attempt = 0;
    for (;;) {
      let error: Error;
      try {
        const timeoutMs = Math.max(
          1000,
          Math.min(this.timeoutMs, deadline - this.now()),
        );
        await this.ensureCookie(timeoutMs);
        const { res, text } = await this.send(url, init, timeoutMs);
        if (!res.ok) throw new HttpError(res.status, text, url);
        this.lastSuccess = this.now();
        if (!this.onFallback) this.primaryFailures = 0;
        return text;
      } catch (e) {
        error = e instanceof Error ? e : new Error(String(e));
      }
      const kind = classify(error);
      if (kind === "fatal") throw error;
      if (kind === "blocked") this.blocks += 1;
      else this.errors += 1;
      // Any retryable failure: new session (IP) and cookie.
      this.cookie = undefined;
      this.rotate();
      const note = this.switchRoute(kind);
      const rotated = this.rotatedDelayMs !== undefined;
      const delay = rotated
        ? this.rotatedDelayMs!
        : Math.min(
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
        `Request failed (${error.message.slice(0, 120)}); ${note}new session, retry ${attempt}/${this.maxRetries} in ${Math.round(delay)}ms`,
      );
      await this.sleep(delay);
    }
  }
}
