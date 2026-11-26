import { fetch, ProxyAgent, type Dispatcher } from "undici";
import type { FetchLike } from "./client.js";

/** Sent by the HTTP client and the WAF-solving browser alike; the WAF token is issued for it. */
export const USER_AGENT =
  "Mozilla/5.0 (compatible; trustpilot-reviews/0.1; +https://apify.com/cprussin/trustpilot-reviews)";

export interface RawRequest {
  method: string;
  headers: Record<string, string>;
  body?: Buffer | null;
}

export interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export type RawFetch = (url: string, req: RawRequest) => Promise<RawResponse>;

export interface Http {
  fetch: FetchLike;
  raw: RawFetch;
}

/**
 * Proxy URL from `make`, or undefined (direct) when it fails, e.g. the user's
 * plan has no access to the selected proxy group. Direct requests work: the
 * WAF token solver handles Trustpilot's bot check.
 */
export async function proxyUrlOrDirect(
  make: () => Promise<string | undefined>,
  log: (msg: string) => void,
): Promise<string | undefined> {
  try {
    return await make();
  } catch (e) {
    log(`Proxy unavailable, continuing without: ${(e as Error).message}`);
    return undefined;
  }
}

/** undici fetch, optionally through an HTTP(S) proxy (one exit IP for all traffic). */
export function makeHttp(proxyUrl?: string): Http {
  const dispatcher: Dispatcher | undefined = proxyUrl
    ? new ProxyAgent(proxyUrl)
    : undefined;
  return {
    fetch: (url, init) => fetch(url, { ...init, dispatcher }),
    raw: async (url, req) => {
      const res = await fetch(url, {
        method: req.method,
        headers: req.headers,
        body: req.body && req.body.length ? req.body : undefined,
        redirect: "manual",
        dispatcher,
        signal: AbortSignal.timeout(30_000),
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k] = v;
      });
      return {
        status: res.status,
        headers,
        body: Buffer.from(await res.arrayBuffer()),
      };
    },
  };
}
