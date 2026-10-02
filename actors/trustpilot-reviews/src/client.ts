import {
  challengeScriptUrl,
  DEFAULT_CHALLENGE_URL,
  isWafChallenge,
} from "./page.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    detail = "",
  ) {
    super(`HTTP ${status} from ${url}${detail ? `: ${detail}` : ""}`);
  }
}

export class BlockedError extends Error {}

/** The token solver itself failed (e.g. browser missing); not retryable here. */
export class SolverError extends Error {}

export type FetchLike = (
  url: string,
  init: {
    headers: Record<string, string>;
    signal?: AbortSignal;
    redirect?: "follow";
  },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

/**
 * Returns a fresh AWS WAF token (the `aws-waf-token` cookie value) for the
 * given challenge script. Implemented with a headless browser in waf.ts.
 */
export type TokenSolver = (challengeUrl: string) => Promise<string>;

export interface ClientOptions {
  fetch: FetchLike;
  solveToken: TokenSolver;
  userAgent: string;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  /** Minimum gap between requests (politeness / rate limiting). */
  minIntervalMs?: number;
  /** Max WAF token solves per run before giving up. */
  maxSolves?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (msg: string) => void;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface PageResponse {
  status: number;
  body: string;
}

/**
 * Fetches Trustpilot HTML pages. Plain HTTP first; when AWS WAF answers with
 * a challenge, gets a token from the solver and retries with the cookie.
 * Retries 429/5xx/network errors with exponential backoff and Retry-After.
 */
export class TrustpilotClient {
  private token?: string;
  private lastRequestAt = 0;
  solves = 0;
  requests = 0;

  private readonly o: Required<Omit<ClientOptions, "log">> & {
    log: (msg: string) => void;
  };

  constructor(opts: ClientOptions) {
    this.o = {
      maxRetries: 4,
      baseDelayMs: 1000,
      maxDelayMs: 30_000,
      timeoutMs: 30_000,
      minIntervalMs: 300,
      maxSolves: 4,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      log: () => {},
      ...opts,
    };
  }

  private headers(): Record<string, string> {
    return {
      "user-agent": this.o.userAgent,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      ...(this.token ? { cookie: `aws-waf-token=${this.token}` } : {}),
    };
  }

  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + this.o.minIntervalMs - this.o.now();
    if (wait > 0) await this.o.sleep(wait);
    this.lastRequestAt = this.o.now();
  }

  /** Returns 200 and 404 pages (both carry __NEXT_DATA__); throws otherwise. */
  async get(url: string): Promise<PageResponse> {
    let attempt = 0;
    let challenges = 0;
    for (;;) {
      let retryAfterMs: number | undefined;
      let error: Error;
      try {
        await this.throttle();
        this.requests += 1;
        const res = await this.o.fetch(url, {
          headers: this.headers(),
          signal: AbortSignal.timeout(this.o.timeoutMs),
          redirect: "follow",
        });
        const body = await res.text();
        if (res.status === 200 || res.status === 404) {
          return { status: res.status, body };
        }
        if (
          isWafChallenge(res.status, body, res.headers.get("x-amzn-waf-action"))
        ) {
          challenges += 1;
          if (challenges > 2 || this.solves >= this.o.maxSolves) {
            throw new BlockedError(
              `Trustpilot bot protection blocked the request after ${this.solves} verification attempts. Try again later or enable Apify Proxy (residential).`,
            );
          }
          this.o.log(
            this.token
              ? "Verification token expired or rejected; refreshing."
              : "Trustpilot asked for browser verification; solving it once.",
          );
          this.solves += 1;
          try {
            this.token = await this.o.solveToken(
              challengeScriptUrl(body) ?? DEFAULT_CHALLENGE_URL,
            );
          } catch (e) {
            throw new SolverError(
              `Trustpilot bot verification failed: ${(e as Error).message}`,
            );
          }
          continue;
        }
        error = new HttpError(res.status, url, body.slice(0, 200));
        if (!RETRYABLE.has(res.status)) throw error;
        const ra = res.headers.get("retry-after");
        if (ra && Number.isFinite(Number(ra))) retryAfterMs = Number(ra) * 1000;
      } catch (e) {
        if (e instanceof BlockedError || e instanceof SolverError) throw e;
        if (e instanceof HttpError && !RETRYABLE.has(e.status)) throw e;
        error = e instanceof Error ? e : new Error(String(e));
      }
      if (attempt >= this.o.maxRetries) throw error;
      const backoff =
        this.o.baseDelayMs * 2 ** attempt * (0.75 + Math.random() * 0.5);
      const delay = Math.min(this.o.maxDelayMs, retryAfterMs ?? backoff);
      attempt += 1;
      this.o.log(
        `Request failed (${error.message.slice(0, 120)}); retry ${attempt}/${this.o.maxRetries} in ${Math.round(delay)}ms`,
      );
      await this.o.sleep(delay);
    }
  }
}
