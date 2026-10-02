/** Minimal InnerTube client with block detection, retries and proxy-session rotation. */

export interface HttpResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface HttpInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  redirect?: "manual" | "follow";
  signal?: AbortSignal;
}

/** `session` identifies a sticky proxy session (same exit IP); rotated after a block. */
export type FetchFn = (
  url: string,
  init: HttpInit,
  session: string,
) => Promise<HttpResponse>;

/** YouTube refused the request (429, bot check, "sorry" page) on every attempt. */
export class BlockedError extends Error {}
/** Non-retryable HTTP error. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface InnertubeClient {
  clientName: string;
  clientVersion: string;
  userAgent: string;
  headerId: string;
  extra?: Record<string, unknown>;
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export const CLIENTS = {
  ANDROID: {
    clientName: "ANDROID",
    clientVersion: "20.10.38",
    userAgent:
      "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
    headerId: "3",
    extra: { androidSdkVersion: 34, osName: "Android", osVersion: "14" },
  },
  ANDROID_VR: {
    clientName: "ANDROID_VR",
    clientVersion: "1.65.10",
    userAgent:
      "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    headerId: "28",
    extra: { androidSdkVersion: 32, osName: "Android", osVersion: "12L" },
  },
  IOS: {
    clientName: "IOS",
    clientVersion: "20.10.4",
    userAgent:
      "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    headerId: "5",
    extra: { deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone" },
  },
  WEB: {
    clientName: "WEB",
    clientVersion: "2.20250925.01.00",
    userAgent: BROWSER_UA,
    headerId: "1",
  },
} satisfies Record<string, InnertubeClient>;

export type ClientKey = keyof typeof CLIENTS;

/** Player clients tried in order; the Android family returns caption URLs that need no PO token. */
export const PLAYER_CLIENTS: ClientKey[] = ["ANDROID", "ANDROID_VR", "IOS"];

const API = "https://www.youtube.com/youtubei/v1";
/** Skips consent interstitials (EU IPs) without accepting tracking. */
const CONSENT_COOKIE = "SOCS=CAI; CONSENT=PENDING+987";

export interface YouTubeClientOptions {
  fetch: FetchFn;
  maxAttempts?: number;
  timeoutMs?: number;
  /** Backoff base in ms (tests use 0). */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
  hl?: string;
}

const newSession = () => `yt_${Math.random().toString(36).slice(2, 12)}`;

/**
 * 429/403, any redirect (InnerTube and timedtext never redirect legitimately;
 * in practice it's google.com/sorry or consent.youtube.com), or a "Sorry" page.
 */
export function isBlockedResponse(status: number, body: string): boolean {
  if (status === 429 || status === 403) return true;
  if (status >= 300 && status < 400) return true;
  return (
    body.length < 20_000 &&
    /<title>Sorry\.\.\.<\/title>|unusual traffic from your computer/i.test(body)
  );
}

export class YouTubeClient {
  private session = newSession();
  readonly stats = { requests: 0, retries: 0, blocks: 0, bodyChars: 0 };
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly backoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (msg: string) => void;
  private readonly hl: string;

  constructor(private readonly opts: YouTubeClientOptions) {
    this.maxAttempts = opts.maxAttempts ?? 4;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.backoffMs = opts.backoffMs ?? 750;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.log = opts.log ?? (() => {});
    this.hl = opts.hl ?? "en";
  }

  /** Switch to a new proxy session (new exit IP). */
  rotateSession(): void {
    this.session = newSession();
  }

  async request(url: string, init: HttpInit, what: string): Promise<string> {
    let last: Error = new Error(`${what}: no attempts made`);
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (attempt > 1) {
        this.stats.retries += 1;
        const jitter = Math.random() * this.backoffMs;
        await this.sleep(this.backoffMs * 2 ** (attempt - 2) + jitter);
      }
      let res: HttpResponse;
      let body: string;
      try {
        this.stats.requests += 1;
        res = await this.opts.fetch(
          url,
          {
            ...init,
            redirect: "manual",
            signal: AbortSignal.timeout(this.timeoutMs),
          },
          this.session,
        );
        body = await res.text();
      } catch (e) {
        last = new Error(`${what}: ${(e as Error).message}`);
        this.log(`${last.message} (attempt ${attempt}/${this.maxAttempts})`);
        this.rotateSession();
        continue;
      }
      this.stats.bodyChars += body.length;
      if (isBlockedResponse(res.status, body)) {
        this.stats.blocks += 1;
        const loc = res.headers.get("location");
        last = new BlockedError(
          `${what}: blocked by YouTube (HTTP ${res.status}${loc ? ` -> ${loc.slice(0, 60)}` : ""})`,
        );
        this.log(`${last.message} (attempt ${attempt}/${this.maxAttempts})`);
        this.rotateSession();
        continue;
      }
      if (res.status >= 500 || res.status === 408) {
        last = new Error(`${what}: HTTP ${res.status}`);
        this.log(`${last.message} (attempt ${attempt}/${this.maxAttempts})`);
        continue;
      }
      if (res.status >= 400)
        throw new HttpError(`${what}: HTTP ${res.status}`, res.status);
      return body;
    }
    throw last;
  }

  private async post(
    endpoint: string,
    clientKey: ClientKey,
    payload: Record<string, unknown>,
    fieldMask?: string,
  ): Promise<unknown> {
    const c: InnertubeClient = CLIENTS[clientKey];
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": c.userAgent,
      "Accept-Language": `${this.hl},en;q=0.8`,
      "X-YouTube-Client-Name": c.headerId,
      "X-YouTube-Client-Version": c.clientVersion,
      Origin: "https://www.youtube.com",
      Cookie: CONSENT_COOKIE,
    };
    if (fieldMask) headers["X-Goog-FieldMask"] = fieldMask;
    const body = JSON.stringify({
      context: {
        client: {
          clientName: c.clientName,
          clientVersion: c.clientVersion,
          hl: this.hl,
          gl: "US",
          ...(c.extra ?? {}),
        },
      },
      ...payload,
    });
    const text = await this.request(
      `${API}/${endpoint}?prettyPrint=false`,
      { method: "POST", headers, body },
      `${endpoint} (${c.clientName})`,
    );
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${endpoint}: invalid JSON response`);
    }
  }

  /** Player response trimmed to what we use (a few KB instead of ~200 KB). */
  player(videoId: string, clientKey: ClientKey): Promise<unknown> {
    return this.post(
      "player",
      clientKey,
      { videoId, contentCheckOk: true, racyCheckOk: true },
      "playabilityStatus,captions,videoDetails",
    );
  }

  /** WEB player microformat (publish date, category, likes). */
  microformat(videoId: string): Promise<unknown> {
    return this.post("player", "WEB", { videoId }, "microformat");
  }

  timedText(url: string): Promise<string> {
    return this.request(
      url,
      {
        headers: {
          "User-Agent": BROWSER_UA,
          "Accept-Language": `${this.hl},en;q=0.8`,
          Cookie: CONSENT_COOKIE,
        },
      },
      "timedtext",
    );
  }

  resolveUrl(url: string): Promise<unknown> {
    return this.post("navigation/resolve_url", "WEB", { url });
  }

  browse(
    params: { browseId: string } | { continuation: string },
  ): Promise<unknown> {
    return this.post("browse", "WEB", params);
  }
}
