import { HttpError, type HttpClient } from "./http.js";

/** Removes Product Hunt's ref/utm tracking from a maker's website URL. */
export function cleanWebsite(u: string): string {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()])
      if (
        k.startsWith("utm_") ||
        (k === "ref" && /producthunt/i.test(url.searchParams.get(k) ?? ""))
      )
        url.searchParams.delete(k);
    return url.toString();
  } catch {
    return u;
  }
}

const isPh = (u: string): boolean => {
  try {
    return /(^|\.)producthunt\.com$/i.test(new URL(u).hostname);
  } catch {
    return false;
  }
};

/**
 * Resolves Product Hunt's /r/... redirect links to the product's own
 * website. www.producthunt.com sits behind a Cloudflare challenge for many
 * IPs; after the first block this stops trying, so a run never slows down.
 */
export class WebsiteResolver {
  blocked = false;
  resolved = 0;

  constructor(
    private readonly http: HttpClient,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  async resolve(link: string | null): Promise<string | null> {
    if (!link) return null;
    if (!isPh(link)) return cleanWebsite(link);
    if (this.blocked) return null;
    let url = link;
    try {
      for (let hop = 0; hop < 4; hop++) {
        const res = await this.http.request(
          { url, redirect: "manual", maxRetries: 1 },
          [301, 302, 303, 307, 308],
        );
        const loc = res.headers.get("location");
        if (!loc || res.status < 300) return null;
        url = new URL(loc, url).toString();
        if (!isPh(url)) {
          this.resolved += 1;
          return cleanWebsite(url);
        }
      }
      return null;
    } catch (e) {
      if (e instanceof HttpError && (e.status === 403 || e.status === 503)) {
        this.blocked = true;
        this.log(
          "Product Hunt's website redirect links are behind a Cloudflare check from this IP; `website` stays empty (`websiteRedirectUrl` still works in a browser).",
        );
        return null;
      }
      return null;
    }
  }
}
