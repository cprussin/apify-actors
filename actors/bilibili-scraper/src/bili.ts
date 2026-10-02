import { HttpError, type HttpClient } from "./http.js";
import {
  keyFromUrl,
  mixinKey,
  plainQuery,
  signQuery,
  type Params,
} from "./wbi.js";

export const API = "https://api.bilibili.com";
export const HOME = "https://www.bilibili.com/";

/** Bilibili "risk control" (风控) responses: -352, -412 and friends. */
export const RISK_CODES = new Set([-352, -412, -351, -799]);
/** Codes meaning the object doesn't exist, was removed, or is hidden. */
export const NOT_FOUND_CODES = new Set([
  -404, 62002, 62004, 62012, 12002, 12061, -626, 53013,
]);

export class RiskControlError extends Error {}

export class ApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly path: string,
  ) {
    super(`Bilibili API ${path} returned code ${code}: ${message}`);
  }
}

export interface GetOptions {
  /** Sign the request with WBI (w_rid + wts). */
  wbi?: boolean;
  referer?: string;
  /** Override BiliOptions.maxRiskRetries for this call. */
  maxRiskRetries?: number;
}

export interface BiliOptions {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  /** Jittered pause between API calls. */
  minDelayMs?: number;
  maxDelayMs?: number;
  /** Retries after a risk-control response, each with a fresh session. */
  maxRiskRetries?: number;
  riskBaseDelayMs?: number;
  log?: (msg: string) => void;
}

interface Envelope {
  code?: number;
  message?: string;
  data?: unknown;
}

const BROWSER_HEADERS: Record<string, string> = {
  accept: "application/json, text/plain, */*",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  "sec-ch-ua":
    '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
};

/** Parses "name=value; Path=/; ..." Set-Cookie values into [name, value]. */
export function parseSetCookie(header: string): [string, string] | null {
  const first = header.split(";")[0] ?? "";
  const eq = first.indexOf("=");
  if (eq <= 0) return null;
  return [first.slice(0, eq).trim(), first.slice(eq + 1).trim()];
}

/**
 * Search and some other endpoints answer code 0 with only `v_voucher` in
 * `data` when the request was flagged. That's risk control, not "no results".
 */
export function isVoucherOnly(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const keys = Object.keys(data);
  return keys.includes("v_voucher") && keys.length <= 2;
}

/**
 * Guest session for Bilibili's web API: buvid3/b_nut cookies from the home
 * page, buvid4 from /x/frontend/finger/spi, WBI keys from /x/web-interface/nav.
 * Requests are sequential with jittered pauses; risk-control answers trigger
 * backoff and a fresh session.
 */
export class BiliClient {
  private readonly cookies = new Map<string, string>();
  private mixin: string | undefined;
  private lastRequestAt = 0;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxRiskRetries: number;
  private readonly riskBaseDelayMs: number;
  private readonly log: (msg: string) => void;
  sessions = 0;
  riskHits = 0;
  /** Grows after each risk-control hit, so the rest of the run is gentler. */
  slowdown = 1;

  constructor(
    private readonly http: HttpClient,
    opts: BiliOptions = {},
  ) {
    this.sleep =
      opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = opts.random ?? Math.random;
    this.now = opts.now ?? Date.now;
    this.minDelayMs = opts.minDelayMs ?? 250;
    this.maxDelayMs = opts.maxDelayMs ?? 700;
    this.maxRiskRetries = opts.maxRiskRetries ?? 3;
    this.riskBaseDelayMs = opts.riskBaseDelayMs ?? 3000;
    this.log = opts.log ?? (() => {});
  }

  cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private store(setCookies: string[]): void {
    for (const h of setCookies) {
      const kv = parseSetCookie(h);
      if (kv && kv[1]) this.cookies.set(kv[0], kv[1]);
    }
  }

  private headers(referer = HOME): Record<string, string> {
    const h: Record<string, string> = {
      ...BROWSER_HEADERS,
      referer,
      origin: "https://www.bilibili.com",
    };
    const c = this.cookieHeader();
    if (c) h.cookie = c;
    return h;
  }

  private async throttle(): Promise<void> {
    const gap =
      this.slowdown *
      (this.minDelayMs + this.random() * (this.maxDelayMs - this.minDelayMs));
    const wait = this.lastRequestAt + gap - this.now();
    if (this.lastRequestAt && wait > 0) await this.sleep(wait);
    this.lastRequestAt = this.now();
  }

  /** Starts (or restarts) the guest session. */
  async refresh(): Promise<void> {
    this.cookies.clear();
    this.mixin = undefined;
    this.sessions += 1;
    await this.throttle();
    const home = await this.http.request(
      {
        url: HOME,
        headers: {
          ...BROWSER_HEADERS,
          accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "none",
        },
      },
      [403, 412],
    );
    this.store(home.setCookies);

    await this.throttle();
    const spi = await this.http.request(
      { url: `${API}/x/frontend/finger/spi`, headers: this.headers() },
      [412],
    );
    this.store(spi.setCookies);
    const spiData = safeJson(spi.text)?.data as
      { b_3?: string; b_4?: string } | undefined;
    if (spiData?.b_3 && !this.cookies.has("buvid3"))
      this.cookies.set("buvid3", spiData.b_3);
    if (spiData?.b_4)
      this.cookies.set("buvid4", encodeURIComponent(spiData.b_4));
    if (!this.cookies.has("buvid3"))
      this.log("No buvid3 cookie from bilibili.com; continuing without it.");

    await this.throttle();
    const nav = await this.http.request(
      { url: `${API}/x/web-interface/nav`, headers: this.headers() },
      [412],
    );
    const img = (
      safeJson(nav.text)?.data as
        { wbi_img?: { img_url?: string; sub_url?: string } } | undefined
    )?.wbi_img;
    if (!img?.img_url || !img.sub_url) {
      throw new RiskControlError(
        `Could not read WBI keys from /x/web-interface/nav (HTTP ${nav.status}).`,
      );
    }
    this.mixin = mixinKey(keyFromUrl(img.img_url), keyFromUrl(img.sub_url));
  }

  /**
   * GET an API path and return `data`. Returns null for "not found / removed"
   * codes. Throws RiskControlError when risk control persists after retries.
   */
  async get<T>(
    path: string,
    params: Params,
    opts: GetOptions = {},
  ): Promise<T | null> {
    const maxRetries = opts.maxRiskRetries ?? this.maxRiskRetries;
    for (let attempt = 0; ; attempt++) {
      let risk: string;
      try {
        if (!this.mixin) await this.refresh();
        await this.throttle();
        const query = opts.wbi
          ? signQuery(params, this.mixin!, Math.round(this.now() / 1000))
          : plainQuery(params);
        const res = await this.http.request(
          {
            url: `${API}${path}?${query}`,
            headers: this.headers(opts.referer),
          },
          [412],
        );
        const body = safeJson(res.text);
        const code = body?.code;
        if (
          res.status === 412 ||
          (code !== undefined && RISK_CODES.has(code))
        ) {
          risk = `HTTP ${res.status}, code ${code ?? "?"}`;
        } else if (!body) {
          throw new ApiError(
            -1,
            `non-JSON response: ${res.text.slice(0, 100)}`,
            path,
          );
        } else if (code === 0) {
          if (isVoucherOnly(body.data)) risk = "empty response with v_voucher";
          else return (body.data ?? null) as T | null;
        } else if (code !== undefined && NOT_FOUND_CODES.has(code)) {
          return null;
        } else {
          throw new ApiError(code ?? -1, body.message ?? "", path);
        }
      } catch (e) {
        if (e instanceof HttpError && e.status === 412) risk = "HTTP 412";
        else if (e instanceof RiskControlError) risk = e.message;
        else throw e;
      }
      this.riskHits += 1;
      this.slowdown = Math.min(4, this.slowdown * 1.5);
      if (attempt >= maxRetries) {
        throw new RiskControlError(
          `Bilibili risk control blocked ${path} (${risk}) after ${attempt + 1} attempts. Try again later or use a proxy.`,
        );
      }
      const delay =
        this.riskBaseDelayMs * 2 ** attempt * (0.75 + this.random() * 0.5);
      this.log(
        `Risk control on ${path} (${risk}); new session and retry ${attempt + 1}/${maxRetries} in ${Math.round(delay)}ms.`,
      );
      await this.sleep(delay);
      this.mixin = undefined;
    }
  }
}

function safeJson(text: string): Envelope | undefined {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" ? (v as Envelope) : undefined;
  } catch {
    return undefined;
  }
}
