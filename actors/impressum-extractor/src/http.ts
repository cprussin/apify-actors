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
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  url?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface ClientOptions {
  /** Transport. Default: global fetch. */
  fetch?: FetchLike;
  /** Retries for blocks (429) and transient errors. Default 1. */
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Per-attempt timeout. Default 20 s. */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

// Rate limits are worth one more try; a 403 from a company site is a block.
const RETRY_BLOCKED = new Set([429]);
const BLOCKED = new Set([401, 403, 405, 429, 451]);
const TRANSIENT = new Set([408, 500, 502, 503, 504]);

type Failure = "blocked" | "transient" | "fatal";

/** How to handle an error from one attempt. */
export function classify(e: unknown): Failure {
  if (e instanceof HttpError) {
    if (BLOCKED.has(e.status)) return "blocked";
    if (TRANSIENT.has(e.status) || e.status >= 500) return "transient";
    return "fatal";
  }
  // Timeouts, connection resets, DNS errors, ...
  return "transient";
}

/** True for errors that mean the host can't be reached at all. */
export function isUnreachable(e: unknown): boolean {
  if (e instanceof HttpError) return false;
  const code = (e as { code?: string })?.code ?? "";
  const msg = e instanceof Error ? e.message : String(e);
  return /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|CERT|certificate|SSL|TLS/i.test(
    `${code} ${msg}`,
  );
}

export interface Page {
  /** Final URL after redirects, when the transport reports it. */
  url: string;
  status: number;
  contentType: string;
  body: string;
}

/**
 * Plain HTTP client for company websites: one retry for rate limits and
 * transient errors (timeouts, network errors, 5xx), no retry for 4xx.
 */
export class HttpClient {
  private readonly fetch: FetchLike;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (msg: string) => void;
  requests = 0;
  blocks = 0;
  errors = 0;

  constructor(opts: ClientOptions = {}) {
    this.fetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.maxRetries = opts.maxRetries ?? 1;
    this.baseDelayMs = opts.baseDelayMs ?? 1500;
    this.maxDelayMs = opts.maxDelayMs ?? 10_000;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.sleep =
      opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.log = opts.log ?? (() => {});
  }

  private async send(url: string): Promise<Page> {
    this.requests += 1;
    const res = await this.fetch(url, {
      method: "GET",
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        "accept-language": "de-DE,de;q=0.9,en;q=0.8,fr;q=0.7",
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = await res.text();
    if (!res.ok) throw new HttpError(res.status, body, url);
    return {
      url: res.url || url,
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      body,
    };
  }

  /** Returns a 2xx response; throws HttpError otherwise. */
  async get(url: string): Promise<Page> {
    let attempt = 0;
    for (;;) {
      let error: Error;
      try {
        return await this.send(url);
      } catch (e) {
        error = e instanceof Error ? e : new Error(String(e));
      }
      const kind = classify(error);
      if (kind === "blocked") this.blocks += 1;
      else if (kind === "transient") this.errors += 1;
      const retry =
        kind === "transient"
          ? !isUnreachable(error)
          : error instanceof HttpError && RETRY_BLOCKED.has(error.status);
      if (!retry || attempt >= this.maxRetries) throw error;
      const delay = Math.min(
        this.maxDelayMs,
        this.baseDelayMs * 2 ** attempt * (0.75 + Math.random() * 0.5),
      );
      attempt += 1;
      this.log(
        `Request failed (${error.message.slice(0, 120)}); retry ${attempt}/${this.maxRetries} in ${Math.round(delay)}ms`,
      );
      await this.sleep(delay);
    }
  }
}
