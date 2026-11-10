/**
 * Per-host robots.txt gate for every URL the actor fetches itself (feeds,
 * media files, published transcripts and each of their redirect hops). Each
 * origin's robots.txt is loaded once per run with the actor's own
 * (non-browser) user agent. A URL is refused when the `*` group disallows it,
 * when any group names a Claude crawler, or when robots.txt can't be verified
 * (any status but 200 or 404, an HTML body, a network error).
 */
import { nodeFetch, RobotsBlockedError, USER_AGENT } from "./download.js";
import { Robots } from "./robots.js";

export type RobotsState =
  { ok: true; robots: Robots } | { ok: false; reason: string };

export type Verdict = { allowed: true } | { allowed: false; reason: string };

const MAX_REDIRECTS = 5;
const MAX_ROBOTS_CHARS = 512 * 1024;

/**
 * Interprets a robots.txt response. A clean 404 means no rules; any other
 * non-200, an HTML body or a group naming a Claude crawler means "skip".
 */
export function robotsFromResponse(
  status: number,
  contentType: string | null,
  body: string,
): RobotsState {
  if (status === 404) return { ok: true, robots: Robots.allowAll() };
  if (status !== 200)
    return { ok: false, reason: `robots.txt returned HTTP ${status}` };
  if (/html/i.test(contentType ?? "") || /^\s*</.test(body))
    return { ok: false, reason: "robots.txt is not a plain-text robots file" };
  const robots = Robots.parse(body);
  if (robots.claudeAgents.length)
    return {
      ok: false,
      reason: `robots.txt has a group for a Claude crawler (${robots.claudeAgents.join(", ")})`,
    };
  return { ok: true, robots };
}

const errText = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  const c = (e as { cause?: { code?: string; message?: string } })?.cause;
  return (c ? `${m} (${c.code ?? c.message ?? ""})` : m).slice(0, 200);
};

export interface RobotsGateOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  log?: (msg: string) => void;
}

export class RobotsGate {
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;
  private readonly log: (msg: string) => void;
  private readonly cache = new Map<string, Promise<RobotsState>>();

  constructor(opts: RobotsGateOptions = {}) {
    this.fetch = opts.fetch ?? nodeFetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.log = opts.log ?? (() => {});
  }

  /** Origins whose robots.txt was loaded (or attempted) this run. */
  get origins(): number {
    return this.cache.size;
  }

  private load(origin: string): Promise<RobotsState> {
    let p = this.cache.get(origin);
    if (!p) {
      p = this.fetchRobots(origin).catch((e: unknown): RobotsState => ({
        ok: false,
        reason: `robots.txt unreachable (${errText(e)})`,
      }));
      p.then((s) => {
        if (!s.ok) this.log(`${origin}: ${s.reason}; skipping its URLs.`);
      });
      this.cache.set(origin, p);
    }
    return p;
  }

  private async fetchRobots(origin: string): Promise<RobotsState> {
    // RFC 9309 2.3.1.2: follow up to five redirects, even across hosts;
    // the file at the end applies.
    let url = new URL("/robots.txt", origin);
    for (let hop = 0; ; hop++) {
      const res = await this.fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { "User-Agent": USER_AGENT, Accept: "text/plain, */*" },
      });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        await res.body?.cancel().catch(() => {});
        const next = new URL(loc, url);
        if (hop >= MAX_REDIRECTS)
          return { ok: false, reason: "robots.txt redirects too often" };
        if (next.protocol !== "http:" && next.protocol !== "https:")
          return { ok: false, reason: "robots.txt redirects to a non-web URL" };
        url = next;
        continue;
      }
      const text = (await res.text()).slice(0, MAX_ROBOTS_CHARS);
      return robotsFromResponse(
        res.status,
        res.headers.get("content-type"),
        text,
      );
    }
  }

  /** Whether the actor may fetch `url`. */
  async check(url: string | URL): Promise<Verdict> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return { allowed: false, reason: "invalid URL" };
    }
    if (u.protocol !== "http:" && u.protocol !== "https:")
      return { allowed: false, reason: `unsupported protocol ${u.protocol}` };
    const state = await this.load(u.origin);
    if (!state.ok)
      return { allowed: false, reason: `${u.hostname}: ${state.reason}` };
    if (!state.robots.isAllowed(u.pathname + u.search))
      return {
        allowed: false,
        reason: `${u.hostname}: robots.txt disallows ${u.pathname}`,
      };
    return { allowed: true };
  }

  /** Throws RobotsBlockedError when `url` may not be fetched. */
  assert = async (url: URL | string): Promise<void> => {
    const v = await this.check(url);
    if (!v.allowed)
      throw new RobotsBlockedError(`Skipped (robots.txt): ${v.reason}.`);
  };
}
