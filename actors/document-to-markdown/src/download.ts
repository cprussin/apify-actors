/** A document fetched from a URL or key-value store. */
export interface Fetched {
  body: Buffer;
  contentType: string | null;
  /** File name from Content-Disposition, the URL path or the record key. */
  fileName: string | null;
}

/** A per-document failure reported to the user (the run continues). */
export class DocumentError extends Error {
  override name = "DocumentError";
}

export interface DownloadOptions {
  maxBytes: number;
  timeoutMs: number;
  headers?: Record<string, string>;
  /** Attempts for network errors, HTTP 429 and 5xx. */
  attempts?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const USER_AGENT =
  "Mozilla/5.0 (compatible; document-to-markdown/0.1; +https://apify.com/cprussin/document-to-markdown)";

export const formatMb = (bytes: number) =>
  `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;

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

/** Reads a response body, aborting once it exceeds `maxBytes`. */
async function readLimited(res: Response, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new DocumentError(
        `The file is larger than the ${formatMb(maxBytes)} limit (maxFileSizeMb).`,
      );
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** Downloads a document with size and time limits and a retry. */
export async function download(
  url: string,
  opts: DownloadOptions,
): Promise<Fetched> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const attempts = opts.attempts ?? 2;
  let lastError: Error = new DocumentError("Download failed.");
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await sleep(1000 * attempt);
    const signal = AbortSignal.timeout(opts.timeoutMs);
    let res: Response;
    try {
      res = await doFetch(url, {
        redirect: "follow",
        signal,
        headers: { "User-Agent": USER_AGENT, Accept: "*/*", ...opts.headers },
      });
    } catch (e) {
      lastError = new DocumentError(
        signal.aborted
          ? `Download timed out after ${opts.timeoutMs / 1000} s.`
          : `Download failed: ${causeOf(e)}`,
      );
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      lastError = new DocumentError(
        `Download failed: HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}.`,
      );
      if (transient(res.status)) continue;
      throw lastError;
    }
    const length = Number(res.headers.get("content-length"));
    if (Number.isFinite(length) && length > opts.maxBytes) {
      await res.body?.cancel().catch(() => {});
      throw new DocumentError(
        `The file is ${formatMb(length)}, over the ${formatMb(opts.maxBytes)} limit (maxFileSizeMb).`,
      );
    }
    try {
      const body = await readLimited(res, opts.maxBytes);
      return {
        body,
        contentType: res.headers.get("content-type"),
        fileName:
          dispositionName(res.headers.get("content-disposition")) ??
          urlFileName(res.url || url),
      };
    } catch (e) {
      if (e instanceof DocumentError) throw e;
      lastError = new DocumentError(
        signal.aborted
          ? `Download timed out after ${opts.timeoutMs / 1000} s.`
          : `Download failed: ${(e as Error).message}`,
      );
    }
  }
  throw lastError;
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
