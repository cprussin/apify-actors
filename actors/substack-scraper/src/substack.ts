import type { HttpClient } from "./http.js";
import type { RawPost } from "./post.js";

/** Posts requested per archive page (Substack may return fewer). */
export const PAGE_SIZE = 50;

export class NotSubstackError extends Error {}

export const archiveUrl = (
  origin: string,
  offset: number,
  search?: string,
): string => {
  const u = new URL("/api/v1/archive", origin);
  u.searchParams.set("sort", "new");
  if (search) u.searchParams.set("search", search);
  u.searchParams.set("offset", String(offset));
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

export function parseArchive(text: string, url: string): RawPost[] {
  const data = parseJson<unknown>(text, url);
  if (!Array.isArray(data)) {
    throw new NotSubstackError(
      `Unexpected archive response from ${new URL(url).hostname}.`,
    );
  }
  return data.filter(
    (p): p is RawPost =>
      !!p &&
      typeof p === "object" &&
      typeof (p as RawPost).id === "number" &&
      typeof (p as RawPost).slug === "string",
  );
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
    offset: number,
    search?: string,
  ): Promise<RawPost[] | null> {
    const url = archiveUrl(origin, offset, search);
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
