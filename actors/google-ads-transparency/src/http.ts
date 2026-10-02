export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly url: string,
  ) {
    super(`HTTP ${status} from ${url.slice(0, 160)}: ${body.slice(0, 160)}`);
  }
}

/** Google rate-limited or blocked this IP (429, captcha, /sorry redirect). */
export class BlockedError extends HttpError {}

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: "manual" | "follow";
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
  /**
   * Called after a block: switch to a new IP (proxy session). May be async,
   * e.g. to create a fallback proxy configuration.
   */
  rotate?: () => void | Promise<void>;
  /** Retry delay after a block when `rotate` gives a new IP. */
  rotatedDelayMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

export const BASE = "https://adstransparency.google.com";
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

const TRANSIENT = new Set([408, 500, 502, 503, 504]);

const isBlock = (status: number, location: string | null, body: string) =>
  status === 429 ||
  status === 403 ||
  ((status === 302 || status === 303) && /\/sorry\//.test(location ?? "")) ||
  (/^\s*</.test(body) && /unusual traffic|recaptcha/i.test(body));

/**
 * HTTP client for the Transparency Center RPC API and ad preview files.
 * Retries transient errors with backoff; on a block (429 / captcha) it calls
 * `rotate` for a new IP and retries.
 */
export class RpcClient {
  private readonly fetch: FetchLike;
  private readonly rotate: () => void | Promise<void>;
  private readonly rotatedDelayMs: number | undefined;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (msg: string) => void;
  requests = 0;
  blocks = 0;

  constructor(opts: ClientOptions = {}) {
    this.fetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.rotate = opts.rotate ?? (() => {});
    this.rotatedDelayMs = opts.rotatedDelayMs;
    this.maxRetries = opts.maxRetries ?? 5;
    this.baseDelayMs = opts.baseDelayMs ?? 2000;
    this.maxDelayMs = opts.maxDelayMs ?? 15_000;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.sleep =
      opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.log = opts.log ?? (() => {});
  }

  /** Calls an RPC like "SearchService/SearchCreatives"; returns parsed JSON. */
  async rpc(method: string, req: unknown): Promise<Record<string, unknown>> {
    const url = `${BASE}/anji/_/rpc/${method}?authuser=0`;
    const text = await this.request(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: BASE,
        referer: `${BASE}/`,
      },
      body: "f.req=" + encodeURIComponent(JSON.stringify(req)),
    });
    if (!text.trim()) return {};
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new HttpError(200, text, url);
    }
  }

  /** GET with retries; returns the body. */
  async get(url: string): Promise<string> {
    return this.request(url, { method: "GET" });
  }

  private async request(
    url: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
  ): Promise<string> {
    let attempt = 0;
    for (;;) {
      let error: Error;
      let blocked = false;
      try {
        this.requests += 1;
        const res = await this.fetch(url, {
          method: init.method,
          headers: {
            "user-agent": USER_AGENT,
            "accept-language": "en-US,en;q=0.9",
            ...init.headers,
          },
          body: init.body,
          redirect: "manual",
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const text = await res.text();
        const location = res.headers.get("location");
        if (res.ok && !isBlock(res.status, location, text)) return text;
        if (isBlock(res.status, location, text)) {
          blocked = true;
          error = new BlockedError(res.status, text, url);
        } else {
          error = new HttpError(res.status, text, url);
          if (!TRANSIENT.has(res.status)) throw error;
        }
      } catch (e) {
        if (e instanceof HttpError && !(e instanceof BlockedError)) {
          if (!TRANSIENT.has(e.status)) throw e;
        }
        error = e instanceof Error ? e : new Error(String(e));
      }
      if (attempt >= this.maxRetries) throw error;
      if (blocked) {
        this.blocks += 1;
        await this.rotate();
      }
      const delay =
        blocked && this.rotatedDelayMs !== undefined
          ? this.rotatedDelayMs
          : Math.min(
              this.maxDelayMs,
              this.baseDelayMs * 2 ** attempt * (0.75 + Math.random() * 0.5),
            );
      attempt += 1;
      this.log(
        `Request failed (${error.message.slice(0, 100)}); ${blocked ? "new session, " : ""}retry ${attempt}/${this.maxRetries} in ${Math.round(delay)}ms`,
      );
      await this.sleep(delay);
    }
  }
}
