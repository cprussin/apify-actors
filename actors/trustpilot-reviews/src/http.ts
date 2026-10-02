import { fetch, ProxyAgent, type Dispatcher } from "undici";
import type { FetchLike } from "./client.js";

/** Desktop Chrome matching Playwright 1.56's Chromium; the WAF token is issued for it. */
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

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
