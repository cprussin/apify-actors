import { BlockedError } from "./challenge.js";
import { HttpError } from "./http.js";

export interface RouteResponse {
  status: number;
  text: string;
}

/** One way to reach AliExpress: direct, or through some proxy. */
export interface Route {
  name: string;
  readonly requests: number;
  /** Returns 403/429 responses instead of throwing, so blocks are visible. */
  get(url: string, headers: Record<string, string>): Promise<RouteResponse>;
  /** New identity (new proxy session / IP). */
  reset(): void;
}

export interface FetcherOptions {
  /** Jittered pause between consecutive requests. */
  minDelayMs?: number;
  maxDelayMs?: number;
  /** Extra attempts per route after a block, each with a new session. */
  blockedRetries?: number;
  /** Base back-off after a block (doubles per attempt, jittered). */
  blockBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  log?: (msg: string) => void;
}

/**
 * Sequential, polite fetcher. Waits a jittered delay between requests. On a
 * block (403/429 or a captcha page detected by `parse`) it backs off, rotates
 * the session and retries; when a route stays blocked it moves to the next
 * route (e.g. direct → Apify datacenter proxy) for the rest of the run.
 */
export class PoliteFetcher {
  private tier = 0;
  private last = 0;
  blocks = 0;
  private readonly o: Required<Omit<FetcherOptions, "log">> & {
    log: (msg: string) => void;
  };

  constructor(
    private readonly routes: Route[],
    opts: FetcherOptions = {},
  ) {
    if (!routes.length) throw new Error("PoliteFetcher needs a route.");
    this.o = {
      minDelayMs: opts.minDelayMs ?? 800,
      maxDelayMs: opts.maxDelayMs ?? 2000,
      blockedRetries: opts.blockedRetries ?? 2,
      blockBackoffMs: opts.blockBackoffMs ?? 4000,
      sleep:
        opts.sleep ??
        ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      random: opts.random ?? Math.random,
      log: opts.log ?? (() => {}),
    };
  }

  get routeName(): string {
    return this.routes[this.tier]!.name;
  }

  get requests(): number {
    return this.routes.reduce((n, r) => n + r.requests, 0);
  }

  private async pace(): Promise<void> {
    const { minDelayMs, maxDelayMs, random, sleep } = this.o;
    const wait = minDelayMs + random() * (maxDelayMs - minDelayMs);
    const elapsed = Date.now() - this.last;
    if (this.last && elapsed < wait) await sleep(wait - elapsed);
    this.last = Date.now();
  }

  async fetch<T>(
    url: string,
    headers: Record<string, string>,
    parse: (text: string) => T,
  ): Promise<T> {
    for (;;) {
      const route = this.routes[this.tier]!;
      let reason: string | undefined;
      for (let attempt = 0; ; attempt++) {
        await this.pace();
        try {
          const res = await route.get(url, headers);
          if (res.status === 403 || res.status === 429) {
            reason = `HTTP ${res.status}`;
          } else {
            return parse(res.text);
          }
        } catch (e) {
          if (e instanceof BlockedError) reason = e.message;
          else if (
            e instanceof HttpError &&
            (e.status === 403 || e.status === 429)
          )
            reason = e.message;
          else throw e;
        }
        this.blocks += 1;
        if (attempt >= this.o.blockedRetries) break;
        route.reset();
        const backoff =
          this.o.blockBackoffMs * 2 ** attempt * (0.75 + this.o.random() * 0.5);
        this.o.log(
          `Blocked via ${route.name} (${(reason ?? "").slice(0, 120)}); new session, retry ${attempt + 1}/${this.o.blockedRetries} in ${Math.round(backoff / 1000)}s.`,
        );
        await this.o.sleep(backoff);
      }
      if (this.tier + 1 >= this.routes.length)
        throw new BlockedError(
          `AliExpress keeps blocking requests (${route.name}: ${(reason ?? "").slice(0, 200)}).`,
        );
      this.tier += 1;
      this.o.log(
        `${route.name} is blocked (${(reason ?? "").slice(0, 120)}); switching to ${this.routes[this.tier]!.name}.`,
      );
    }
  }
}
