import type { HttpClient } from "./http.js";
import type { RawPost } from "./post.js";

/**
 * Posts requested per archive page (Substack may return fewer). Since
 * 2026-11 the archive API rejects limits above ~25.
 */
export const PAGE_SIZE = 20;

/** Where to read the next archive page from. */
export interface ArchivePageRef {
  /** Opaque `nextCursor` from the previous page (current API). */
  cursor?: string;
  /** Legacy offset paging, used only if the API answers with a bare array. */
  offset?: number;
}

export interface ArchivePage {
  posts: RawPost[];
  /**
   * Cursor for the next page: a string to continue, `null` at the end, or
   * `undefined` when the API used the legacy bare-array shape (page by offset).
   */
  nextCursor?: string | null;
}

export class NotSubstackError extends Error {}

export const archiveUrl = (
  origin: string,
  page: ArchivePageRef = {},
  search?: string,
): string => {
  const u = new URL("/api/v1/archive", origin);
  u.searchParams.set("sort", "new");
  if (search) u.searchParams.set("search", search);
  // The current API rejects `offset` (even 0); send it only for legacy paging.
  if (page.cursor) u.searchParams.set("cursor", page.cursor);
  else if (page.offset) u.searchParams.set("offset", String(page.offset));
  u.searchParams.set("limit", String(PAGE_SIZE));
  return u.toString();
};

export const postUrl = (origin: string, slug: string): string =>
  new URL(`/api/v1/posts/${encodeURIComponent(slug)}`, origin).toString();

function parseJson<T>(text: string, url: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new NotSubstackError(
      `${new URL(url).hostname} did not return Substack JSON; is it a Substack publication?`,
    );
  }
}

const isRawPost = (p: unknown): p is RawPost =>
  !!p &&
  typeof p === "object" &&
  typeof (p as RawPost).id === "number" &&
  typeof (p as RawPost).slug === "string";

export function parseArchive(text: string, url: string): ArchivePage {
  const data = parseJson<unknown>(text, url);
  if (Array.isArray(data)) return { posts: data.filter(isRawPost) };
  const obj = data as { posts?: unknown; nextCursor?: unknown } | null;
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.posts)) {
    throw new NotSubstackError(
      `Unexpected archive response from ${new URL(url).hostname}.`,
    );
  }
  return {
    posts: obj.posts.filter(isRawPost),
    nextCursor:
      typeof obj.nextCursor === "string" && obj.nextCursor
        ? obj.nextCursor
        : null,
  };
}

export function parsePost(text: string, url: string): RawPost {
  const p = parseJson<RawPost>(text, url);
  if (!p || typeof p.id !== "number" || typeof p.slug !== "string") {
    throw new NotSubstackError(`Unexpected post response from ${url}.`);
  }
  return p;
}

export class SubstackClient {
  constructor(private readonly http: HttpClient) {}

  /** One archive page, or `null` if the publication doesn't exist (404). */
  async archivePage(
    origin: string,
    page: ArchivePageRef,
    search?: string,
  ): Promise<ArchivePage | null> {
    const url = archiveUrl(origin, page, search);
    const res = await this.http.request(
      { url, headers: { accept: "application/json" } },
      [404],
    );
    if (res.status === 404) return null;
    return parseArchive(res.text, url);
  }

  /** Full post (public part only), or `null` if not found. */
  async post(origin: string, slug: string): Promise<RawPost | null> {
    const url = postUrl(origin, slug);
    const res = await this.http.request(
      { url, headers: { accept: "application/json" } },
      [404],
    );
    if (res.status === 404) return null;
    return parsePost(res.text, url);
  }
}
