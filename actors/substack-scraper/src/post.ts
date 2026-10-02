/** Subset of the Substack API post object that we read. */
export interface RawPost {
  id: number;
  publication_id?: number;
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  slug: string;
  canonical_url?: string | null;
  post_date?: string | null;
  audience?: string | null;
  type?: string | null;
  reaction_count?: number | null;
  restacks?: number | null;
  comment_count?: number | null;
  wordcount?: number | null;
  cover_image?: string | null;
  section_name?: string | null;
  postTags?: { name?: string }[] | null;
  body_html?: string | null;
  publishedBylines?: {
    id?: number;
    name?: string;
    handle?: string;
    publicationUsers?: {
      publication?: { id?: number; name?: string };
    }[];
  }[];
}

export interface Author {
  id: number | null;
  name: string;
  handle: string | null;
}

/** One post in the output schema. */
export interface Post {
  /** Host of the publication, e.g. "www.lennysnewsletter.com". */
  publication: string;
  publicationName: string | null;
  postId: number;
  title: string;
  subtitle: string | null;
  slug: string;
  url: string;
  /** ISO 8601 timestamp. */
  postDate: string | null;
  audience: "free" | "paid";
  /** newsletter, podcast, thread, ... as reported by Substack. */
  type: string;
  likes: number | null;
  restacks: number | null;
  commentCount: number | null;
  wordcount: number | null;
  authors: Author[];
  coverImage: string | null;
  section: string | null;
  tags: string[];
  /** Only with includeContent. Public HTML (preview only for paid posts). */
  bodyHtml: string | null;
  bodyText: string | null;
  /** Only with includeContent: true when bodyHtml is a paywall preview. */
  truncated: boolean | null;
}

const PAID = new Set(["only_paid", "founding"]);

export const isPaid = (p: RawPost): boolean => PAID.has(p.audience ?? "");

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;

/**
 * Record publication names (by publication id) found in post bylines. Guest
 * or byline-less posts don't carry the name, so callers share one map.
 */
export function learnPublicationNames(
  raws: RawPost[],
  names: Map<number, string>,
): void {
  for (const raw of raws) {
    for (const b of raw.publishedBylines ?? []) {
      for (const u of b.publicationUsers ?? []) {
        const p = u.publication;
        if (p?.id !== undefined && p.name && !names.has(p.id)) {
          names.set(p.id, p.name);
        }
      }
    }
  }
}

const hostOf = (url: string | null | undefined): string | null => {
  try {
    return url ? new URL(url).hostname : null;
  } catch {
    return null;
  }
};

export function toPost(
  raw: RawPost,
  origin: string,
  content?: { bodyHtml: string | null },
  names: Map<number, string> = new Map(),
): Post {
  learnPublicationNames([raw], names);
  const publication = hostOf(raw.canonical_url) ?? new URL(origin).hostname;
  const publicationName =
    raw.publication_id !== undefined
      ? (names.get(raw.publication_id) ?? null)
      : null;
  const authors: Author[] = (raw.publishedBylines ?? [])
    .filter((b) => b.name)
    .map((b) => ({ id: num(b.id), name: b.name!, handle: str(b.handle) }));

  let bodyHtml: string | null = null;
  let bodyText: string | null = null;
  let truncated: boolean | null = null;
  if (content) {
    bodyHtml = str(content.bodyHtml);
    bodyText = bodyHtml ? htmlToText(bodyHtml) : null;
    truncated = isPaid(raw) && isPreview(bodyText, raw.wordcount);
  }

  return {
    publication,
    publicationName,
    postId: raw.id,
    title: raw.title ?? "",
    subtitle: str(raw.subtitle),
    slug: raw.slug,
    url: str(raw.canonical_url) ?? `${origin}/p/${raw.slug}`,
    postDate: str(raw.post_date)
      ? new Date(raw.post_date!).toISOString()
      : null,
    audience: isPaid(raw) ? "paid" : "free",
    type: raw.type ?? "newsletter",
    likes: num(raw.reaction_count),
    restacks: num(raw.restacks),
    commentCount: num(raw.comment_count),
    wordcount: num(raw.wordcount),
    authors,
    coverImage: str(raw.cover_image),
    section: str(raw.section_name),
    tags: (raw.postTags ?? [])
      .map((t) => t.name)
      .filter((n): n is string => !!n),
    bodyHtml,
    bodyText,
    truncated,
  };
}

/**
 * A paid post is a preview when the public text is clearly shorter than the
 * post's word count (or there is no public text at all).
 */
function isPreview(
  text: string | null,
  wordcount: number | null | undefined,
): boolean {
  if (!text) return true;
  if (!wordcount) return true;
  const words = text.split(/\s+/).filter(Boolean).length;
  return words < wordcount * 0.95;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code =
        e[1] === "x" || e[1] === "X"
          ? parseInt(e.slice(2), 16)
          : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const BLOCK =
  /<\/?(p|div|h[1-6]|ul|ol|blockquote|pre|figure|figcaption|table|tr|section|article|hr)\b[^>]*>/gi;

/** Readable plain text from Substack post HTML (paragraphs separated by blank lines). */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style|svg|button|form)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/li>/gi, "")
    .replace(BLOCK, "\n\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
