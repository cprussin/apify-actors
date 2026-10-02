/** A publication archive to page through, or a single post. */
export type Target =
  | { kind: "publication"; origin: string }
  | { kind: "post"; origin: string; slug: string };

export class TargetError extends Error {}

const HOST_RE =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const SUB_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const RESERVED_SUBSTACK = new Set(["www", "open", "on", "api", "cdn"]);

export const targetKey = (t: Target): string =>
  t.kind === "post" ? `${t.origin}/p/${t.slug}` : t.origin;

/**
 * Parse a publication or post reference:
 * - "lenny" -> https://lenny.substack.com
 * - "lenny.substack.com", "https://lenny.substack.com/archive" -> publication
 * - "www.lennysnewsletter.com" (custom domain) -> publication
 * - "https://lenny.substack.com/p/some-slug" -> post
 * - "https://open.substack.com/pub/lenny/p/some-slug" -> post
 */
export function parseTarget(input: string): Target {
  const s = input.trim();
  if (!s) throw new TargetError("Empty publication reference.");

  if (SUB_RE.test(s.toLowerCase()) && !s.includes(".")) {
    return {
      kind: "publication",
      origin: `https://${s.toLowerCase()}.substack.com`,
    };
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    throw new TargetError(`"${s}" is not a Substack URL or subdomain.`);
  }
  const host = url.hostname.toLowerCase();
  if (!HOST_RE.test(host)) {
    throw new TargetError(`"${s}" is not a Substack URL or subdomain.`);
  }
  const parts = url.pathname.split("/").filter(Boolean);

  if (
    host === "substack.com" ||
    host === "www.substack.com" ||
    host === "open.substack.com"
  ) {
    // open.substack.com/pub/<sub>/p/<slug>
    if (parts[0] === "pub" && parts[1] && SUB_RE.test(parts[1])) {
      const origin = `https://${parts[1].toLowerCase()}.substack.com`;
      if (parts[2] === "p" && parts[3])
        return { kind: "post", origin, slug: parts[3] };
      return { kind: "publication", origin };
    }
    throw new TargetError(
      `"${s}" is a substack.com page, not a publication. Use the publication's own URL, e.g. https://name.substack.com or its custom domain.`,
    );
  }
  if (host.endsWith(".substack.com")) {
    const sub = host.slice(0, -".substack.com".length);
    if (sub.includes(".") || RESERVED_SUBSTACK.has(sub)) {
      throw new TargetError(`"${s}" is not a Substack publication URL.`);
    }
  }

  const origin = `https://${host}`;
  if (parts[0] === "p" && parts[1]) {
    return { kind: "post", origin, slug: decodeURIComponent(parts[1]) };
  }
  return { kind: "publication", origin };
}
