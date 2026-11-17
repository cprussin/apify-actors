import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { open } from "node:fs/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

/** A media file saved to disk. */
export interface Downloaded {
  path: string;
  bytes: number;
  contentType: string | null;
  /** File name from Content-Disposition, the URL path or the record key. */
  fileName: string | null;
  /** The first bytes, for type sniffing. */
  head: Buffer;
}

/** A per-file failure reported to the user (the run continues). */
export class MediaError extends Error {
  override name = "MediaError";
}

export interface DownloadOptions {
  maxBytes: number;
  timeoutMs: number;
  headers?: Record<string, string>;
  /** Attempts for network errors, HTTP 429 and 5xx. */
  attempts?: number;
  fetchImpl?: typeof fetch;
  /** Skip the private-address guard (local tests only). */
  allowPrivate?: boolean;
  sleep?: (ms: number) => Promise<void>;
}

const USER_AGENT =
  "Mozilla/5.0 (compatible; media-converter/0.1; +https://apify.com/cprussin/media-converter)";

export const HEAD_BYTES = 4096;
const MAX_REDIRECTS = 10;

/** Loopback, private, link-local (cloud metadata), CGNAT and other non-public ranges. */
const BLOCKED = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const)
  BLOCKED.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  BLOCKED.addSubnet(net, bits, "ipv6");

/** True for an IP address that is not on the public internet. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return BLOCKED.check(ip, "ipv4");
  if (v !== 6) return false;
  // IPv4-mapped IPv6 (::ffff:10.0.0.1).
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return BLOCKED.check(mapped[1]!, "ipv4");
  return BLOCKED.check(ip, "ipv6");
}

const privateError = (host: string) =>
  new MediaError(
    `${host} is a private or internal address. Only public URLs are downloaded.`,
  );

/**
 * DNS lookup that refuses private addresses, so a public hostname that
 * resolves (or redirects) to an internal service is never contacted.
 */
const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || !list.length) return callback(privateError(hostname), "", 4);
    if (options.all) return (callback as unknown as AllCallback)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};
type AllCallback = (err: Error | null, addresses: LookupAddress[]) => void;

/** Fails for URLs whose host is a literal private IP or localhost. */
export function assertPublicUrl(url: URL): void {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    isPrivateAddress(host) ||
    host === "localhost" ||
    host.endsWith(".localhost")
  )
    throw privateError(host);
}

/**
 * A minimal fetch() on node:http(s), following redirects. Node 22.23's
 * built-in fetch (undici 6.28) crashes the whole process with
 * "assert(!this.paused)" when a server closes the connection while a slow
 * reader (e.g. writing to disk) holds the body back. Every hop is checked
 * against private addresses unless `allowPrivate` (tests) is set.
 */
export const makeNodeFetch =
  (allowPrivate = false): typeof fetch =>
  async (input, init = {}) => {
    let url = new URL(String(input));
    const headers = (init.headers ?? {}) as Record<string, string>;
    for (let hop = 0; ; hop++) {
      if (!allowPrivate) assertPublicUrl(url);
      const res = await new Promise<IncomingMessage>((resolve, reject) => {
        const send = url.protocol === "https:" ? httpsRequest : httpRequest;
        const req = send(
          url,
          {
            headers,
            signal: init.signal ?? undefined,
            ...(allowPrivate ? {} : { lookup: publicLookup }),
          },
          resolve,
        );
        req.on("error", reject);
        req.end();
      });
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.resume();
        if (hop >= MAX_REDIRECTS) throw new Error("too many redirects");
        url = new URL(location, url);
        continue;
      }
      const h = new Headers();
      for (const [k, v] of Object.entries(res.headers))
        for (const x of [v ?? []].flat()) h.append(k, x);
      const empty = status === 204 || status === 205 || status === 304;
      if (empty) res.resume();
      const response = new Response(
        empty ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>),
        { status, statusText: res.statusMessage ?? "", headers: h },
      );
      Object.defineProperty(response, "url", { value: url.href });
      return response;
    }
  };

export const nodeFetch = makeNodeFetch();

export const formatMb = (bytes: number) =>
  `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;

const tooLarge = (maxBytes: number, size?: number) =>
  new MediaError(
    size === undefined
      ? `The file is larger than the ${formatMb(maxBytes)} limit (maxFileSizeMb).`
      : `The file is ${formatMb(size)}, over the ${formatMb(maxBytes)} limit (maxFileSizeMb).`,
  );

/** File name from a Content-Disposition header. */
export function dispositionName(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1]!.trim().replace(/^"|"$/g, ""));
    } catch {
      // Fall through to the plain parameter.
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain ? plain[1]!.trim() : null;
}

/** Last path segment of a URL, decoded. */
export function urlFileName(url: string): string | null {
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean).at(-1);
    return seg ? decodeURIComponent(seg) : null;
  } catch {
    return null;
  }
}

/** fetch() wraps network errors ("fetch failed"); the cause says why. */
const causeOf = (e: unknown): string => {
  const err = e as Error & { cause?: { code?: string; message?: string } };
  return err.cause?.code ?? err.cause?.message ?? err.message;
};

const transient = (status: number) => status === 429 || status >= 500;

/** Calls `sink` with each body chunk, failing once it exceeds `maxBytes`. */
export async function pipeLimited(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
  sink: (chunk: Uint8Array) => Promise<void> | void,
): Promise<number> {
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > maxBytes) throw tooLarge(maxBytes);
    await sink(chunk);
  }
  return total;
}

/** Writes a stream to `path` with a size limit; returns size and head. */
export async function saveStream(
  body: AsyncIterable<Uint8Array>,
  path: string,
  maxBytes: number,
): Promise<{ bytes: number; head: Buffer }> {
  const file = await open(path, "w");
  const head: Buffer[] = [];
  let headLen = 0;
  try {
    const bytes = await pipeLimited(body, maxBytes, async (chunk) => {
      if (headLen < HEAD_BYTES) {
        head.push(Buffer.from(chunk.subarray(0, HEAD_BYTES - headLen)));
        headLen += Math.min(chunk.byteLength, HEAD_BYTES - headLen);
      }
      await file.write(chunk);
    });
    return { bytes, head: Buffer.concat(head) };
  } finally {
    await file.close();
  }
}

/** GET with a timeout and a retry on network errors, 429 and 5xx. */
async function request(
  url: string,
  opts: DownloadOptions,
  what: string,
  use: (res: Response, signal: AbortSignal) => Promise<unknown>,
): Promise<unknown> {
  const doFetch =
    opts.fetchImpl ?? (opts.allowPrivate ? makeNodeFetch(true) : nodeFetch);
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const attempts = opts.attempts ?? 2;
  let lastError: Error = new MediaError(`${what} failed.`);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await sleep(1000 * attempt);
    const signal = AbortSignal.timeout(opts.timeoutMs);
    let res: Response;
    try {
      res = await doFetch(url, {
        redirect: "follow",
        signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "video/*,audio/*,*/*;q=0.8",
          ...opts.headers,
        },
      });
    } catch (e) {
      // The private-address guard: not worth a retry.
      if (e instanceof MediaError) throw e;
      lastError = new MediaError(
        signal.aborted
          ? `${what} timed out after ${opts.timeoutMs / 1000} s.`
          : `${what} failed: ${causeOf(e)}`,
      );
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      lastError = new MediaError(
        `${what} failed: HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}.`,
      );
      if (transient(res.status)) continue;
      throw lastError;
    }
    const length = Number(res.headers.get("content-length"));
    if (Number.isFinite(length) && length > opts.maxBytes) {
      await res.body?.cancel().catch(() => {});
      throw tooLarge(opts.maxBytes, length);
    }
    try {
      return await use(res, signal);
    } catch (e) {
      if (e instanceof MediaError) throw e;
      lastError = new MediaError(
        signal.aborted
          ? `${what} timed out after ${opts.timeoutMs / 1000} s.`
          : `${what} failed: ${causeOf(e)}`,
      );
    }
  }
  throw lastError;
}

/** Downloads a media file to `path` with size and time limits. */
export async function downloadToFile(
  url: string,
  path: string,
  opts: DownloadOptions,
): Promise<Downloaded> {
  return (await request(url, opts, "Download", async (res) => {
    const { bytes, head } = res.body
      ? await saveStream(res.body, path, opts.maxBytes)
      : { bytes: 0, head: Buffer.alloc(0) };
    return {
      path,
      bytes,
      head,
      contentType: res.headers.get("content-type"),
      fileName:
        dispositionName(res.headers.get("content-disposition")) ??
        urlFileName(res.url || url),
    } satisfies Downloaded;
  })) as Downloaded;
}

/**
 * Apify API URLs of key-value store records get the run's token, so files
 * uploaded to a private store can be passed as URLs.
 */
export function authHeaders(
  url: string,
  token: string | undefined,
): Record<string, string> {
  if (!token) return {};
  try {
    const u = new URL(url);
    if (
      u.protocol === "https:" &&
      u.hostname === "api.apify.com" &&
      /^\/v2\/key-value-stores\/[^/]+\/records\//.test(u.pathname)
    )
      return { Authorization: `Bearer ${token}` };
  } catch {
    // Invalid URL: no headers.
  }
  return {};
}
