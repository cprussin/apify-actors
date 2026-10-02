/**
 * Official Product Hunt API v2 (GraphQL), used when the user supplies a
 * developer token. Gives the full launch record: description, website,
 * topics, media, comments, historical leaderboards. Makers' and commenters'
 * personal fields are redacted by Product Hunt for third-party tokens.
 */
import { HttpError, retryAfterSeconds, type HttpClient } from "./http.js";
import {
  clean,
  ptDate,
  type Comment,
  type Launch,
  type Media,
  type Person,
  type PostRef,
} from "./launch.js";

export const API_URL = "https://api.producthunt.com/v2/api/graphql";
export const PAGE_SIZE = 20;

export class TokenError extends Error {}

/** Fields requested per GraphQL type. Unknown ones are dropped at runtime. */
const FIELDS = {
  Post: [
    "id",
    "name",
    "tagline",
    "description",
    "slug",
    "url",
    "website",
    "votesCount",
    "commentsCount",
    "reviewsCount",
    "reviewsRating",
    "createdAt",
    "featuredAt",
    "thumbnail { type url videoUrl }",
    "media { type url videoUrl }",
    "productLinks { type url }",
    "topics(first: 10) { edges { node { name slug } } }",
    "user { ...U }",
  ],
  Maker: ["makers { ...U }"],
  User: [
    "id",
    "name",
    "username",
    "headline",
    "url",
    "twitterUsername",
    "websiteUrl",
    "profileImage",
  ],
  Comment: [
    "id",
    "body",
    "createdAt",
    "votesCount",
    "parentId",
    "url",
    "user { ...U }",
  ],
};
type TypeName = keyof typeof FIELDS;

export interface PostsQuery {
  order?: "RANKING" | "NEWEST" | "VOTES" | "FEATURED_AT";
  postedAfter?: string;
  postedBefore?: string;
  featured?: boolean;
  topic?: string;
}

interface RawUser {
  id?: string;
  name?: string;
  username?: string;
  headline?: string | null;
  url?: string;
  twitterUsername?: string | null;
  websiteUrl?: string | null;
  profileImage?: string | null;
}

export interface RawPost {
  id: string;
  name: string;
  tagline?: string;
  description?: string | null;
  slug?: string;
  url?: string;
  website?: string | null;
  votesCount?: number;
  commentsCount?: number;
  reviewsCount?: number;
  reviewsRating?: number;
  createdAt?: string;
  featuredAt?: string | null;
  thumbnail?: { type?: string; url?: string; videoUrl?: string | null } | null;
  media?: { type?: string; url?: string; videoUrl?: string | null }[];
  productLinks?: { type?: string; url?: string }[];
  topics?: { edges: { node: { name: string; slug: string } }[] };
  user?: RawUser | null;
  makers?: RawUser[];
}

interface RawComment {
  id: string;
  body?: string;
  createdAt?: string;
  votesCount?: number;
  parentId?: string | null;
  url?: string;
  user?: RawUser | null;
}

interface Connection<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  edges: { node: T }[];
}

export function toPerson(u: RawUser | null | undefined): Person | null {
  if (!u) return null;
  const p: Person = {
    id: clean(u.id),
    name: clean(u.name),
    username: clean(u.username),
    headline: clean(u.headline),
    profileUrl: clean(u.url),
    twitterUsername: clean(u.twitterUsername),
    websiteUrl: clean(u.websiteUrl),
    avatarUrl: clean(u.profileImage),
  };
  if (p.id === "0" || (p.id === null && p.name === null && !p.username))
    return null;
  return p;
}

const stripPhTracking = (u: string | null | undefined): string | null => {
  const s = clean(u);
  if (!s) return null;
  try {
    const url = new URL(s);
    for (const k of [...url.searchParams.keys()])
      if (k.startsWith("utm_")) url.searchParams.delete(k);
    return url.toString();
  } catch {
    return s;
  }
};

const toMedia = (m: {
  type?: string;
  url?: string;
  videoUrl?: string | null;
}): Media => ({
  type: clean(m.type),
  url: clean(m.url),
  videoUrl: clean(m.videoUrl),
});

export function postToLaunch(
  p: RawPost,
  scrapedAt: string,
  includeMakers: boolean,
): Launch {
  const launchAt = p.featuredAt ?? p.createdAt ?? null;
  return {
    id: String(p.id),
    name: p.name,
    tagline: clean(p.tagline),
    description: clean(p.description),
    slug: clean(p.slug),
    url:
      stripPhTracking(p.url) ??
      `https://www.producthunt.com/posts/${p.slug ?? p.id}`,
    website: null,
    websiteRedirectUrl: stripPhTracking(p.website),
    topics: p.topics?.edges.map((e) => e.node.name) ?? [],
    votesCount: p.votesCount ?? null,
    commentsCount: p.commentsCount ?? null,
    reviewsCount: p.reviewsCount ?? null,
    reviewsRating: p.reviewsRating ?? null,
    dailyRank: null,
    weeklyRank: null,
    monthlyRank: null,
    launchDate: ptDate(launchAt),
    createdAt: p.createdAt ?? null,
    featuredAt: p.featuredAt ?? null,
    featured: p.featuredAt !== undefined ? p.featuredAt !== null : null,
    thumbnail: clean(p.thumbnail?.url),
    media: (p.media ?? []).map(toMedia).filter((m) => m.url),
    hunter: toPerson(p.user),
    makers: includeMakers
      ? (p.makers ?? []).map(toPerson).filter((m): m is Person => m !== null)
      : null,
    pricingType: null,
    productLinks: (p.productLinks ?? [])
      .filter((l) => clean(l.url))
      .map((l) => ({ type: clean(l.type), url: clean(l.url)! })),
    source: "api",
    scrapedAt,
  };
}

export function toComment(c: RawComment): Comment {
  return {
    id: String(c.id),
    body: (c.body ?? "").trim(),
    createdAt: c.createdAt ?? null,
    votesCount: c.votesCount ?? null,
    parentId: clean(c.parentId),
    url: clean(c.url),
    author: toPerson(c.user),
  };
}

const MISSING_FIELD = /Field '(\w+)' doesn't exist on type '(\w+)'/g;

export interface ApiOptions {
  token: string;
  includeMakers: boolean;
  log?: (msg: string) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Longest single wait for the rate-limit window to reset. */
  maxRateLimitWaitMs?: number;
}

export class ApiSource {
  private readonly fields: Record<TypeName, string[]> = {
    Post: [...FIELDS.Post],
    Maker: [...FIELDS.Maker],
    User: [...FIELDS.User],
    Comment: [...FIELDS.Comment],
  };
  private readonly log: (msg: string) => void;
  private readonly sleep: (ms: number) => Promise<void>;
  private commentOrder = true;
  rateLimitRemaining: number | null = null;

  constructor(
    private readonly http: HttpClient,
    private readonly o: ApiOptions,
  ) {
    this.log = o.log ?? (() => {});
    this.sleep =
      o.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private postSelection(): string {
    const f = [...this.fields.Post];
    if (this.o.includeMakers) f.push(...this.fields.Maker);
    return f.join(" ");
  }

  private fragment(): string {
    return `fragment U on User { ${this.fields.User.join(" ")} }`;
  }

  /** Posts a GraphQL query. Waits out rate limits; drops unknown fields. */
  async gql<T>(build: () => string, variables: object): Promise<T> {
    let waits = 0;
    for (let attempt = 0; ; attempt++) {
      const query = build();
      let res;
      try {
        res = await this.http.request(
          {
            url: API_URL,
            method: "POST",
            headers: {
              authorization: `Bearer ${this.o.token}`,
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify({ query, variables }),
            maxRetries: 3,
          },
          [401, 403, 429],
        );
      } catch (e) {
        if (e instanceof HttpError && e.status === 400) {
          const fixed = this.dropUnknown(e.body);
          if (fixed && attempt < 15) continue;
        }
        throw e;
      }
      const remaining = Number(res.headers.get("x-rate-limit-remaining"));
      if (
        Number.isFinite(remaining) &&
        res.headers.get("x-rate-limit-remaining")
      )
        this.rateLimitRemaining = remaining;
      if (res.status === 401 || res.status === 403) {
        throw new TokenError(
          `Product Hunt rejected the API token (HTTP ${res.status}). Create a developer token at https://www.producthunt.com/v2/oauth/applications and paste it into "Product Hunt API token", or leave it empty to use the token-free feed.`,
        );
      }
      if (res.status === 429) {
        const reset = retryAfterSeconds(res.headers) ?? 60;
        const waitMs = Math.min(
          (reset + 2) * 1000,
          this.o.maxRateLimitWaitMs ?? 15.5 * 60_000,
        );
        if (++waits > 3)
          throw new Error(
            "Product Hunt API rate limit: still limited after 3 waits.",
          );
        this.log(
          `Product Hunt API rate limit reached; waiting ${Math.round(waitMs / 1000)}s for it to reset.`,
        );
        await this.sleep(waitMs);
        continue;
      }
      let body: { data?: T; errors?: { message?: string; error?: string }[] };
      try {
        body = JSON.parse(res.text);
      } catch {
        throw new Error(
          `Product Hunt API returned non-JSON: ${res.text.slice(0, 200)}`,
        );
      }
      if (body.errors?.length) {
        if (this.dropUnknown(res.text) && attempt < 15) continue;
        if (!body.data)
          throw new Error(
            `Product Hunt API error: ${body.errors.map((e) => e.message ?? e.error).join("; ")}`,
          );
      }
      if (!body.data) throw new Error("Product Hunt API returned no data.");
      return body.data;
    }
  }

  /** Removes fields the schema rejected. Returns true if anything changed. */
  private dropUnknown(text: string): boolean {
    let changed = false;
    for (const m of text.matchAll(MISSING_FIELD)) {
      const field = m[1]!;
      const onType = m[2]!;
      if (!["Post", "Comment", "User"].includes(onType)) {
        // A nested object type (Media, ProductLink, ...): edit sub-selections.
        const re = new RegExp(`(\\{[^{}]*?)\\s${field}\\b`, "g");
        for (const t of Object.keys(this.fields) as TypeName[]) {
          const next = this.fields[t].map((f) => f.replace(re, "$1"));
          if (next.join() !== this.fields[t].join()) {
            this.fields[t] = next;
            changed = true;
            this.log(
              `API field ${onType}.${field} is not available; skipping it.`,
            );
          }
        }
        continue;
      }
      const types: TypeName[] =
        onType === "Post"
          ? ["Post", "Maker"]
          : onType === "Comment"
            ? ["Comment"]
            : ["User"];
      for (const t of types) {
        const before = this.fields[t].length;
        this.fields[t] = this.fields[t].filter(
          (f) => f.split(/[\s({]/)[0] !== field,
        );
        if (this.fields[t].length !== before) {
          changed = true;
          this.log(`API field ${t}.${field} is not available; skipping it.`);
        }
      }
    }
    if (
      !changed &&
      this.commentOrder &&
      /Argument 'order' on Field 'comments'/i.test(text)
    ) {
      this.commentOrder = false;
      return true;
    }
    return changed;
  }

  /** Pages through posts(...) newest cursor first. */
  async *posts(q: PostsQuery): AsyncGenerator<RawPost> {
    let after: string | null = null;
    const args: string[] = [];
    const defs: string[] = [];
    const vars: Record<string, unknown> = {};
    const add = (name: string, type: string, v: unknown) => {
      if (v === undefined) return;
      defs.push(`$${name}: ${type}`);
      args.push(`${name}: $${name}`);
      vars[name] = v;
    };
    add("order", "PostsOrder", q.order);
    add("postedAfter", "DateTime", q.postedAfter);
    add("postedBefore", "DateTime", q.postedBefore);
    add("featured", "Boolean", q.featured);
    add("topic", "String", q.topic);
    for (;;) {
      const data: { posts: Connection<RawPost> } = await this.gql(
        () =>
          `query Posts($first: Int!, $after: String${defs.map((d) => `, ${d}`).join("")}) {
  posts(first: $first, after: $after${args.map((a) => `, ${a}`).join("")}) {
    pageInfo { hasNextPage endCursor }
    edges { node { ${this.postSelection()} } }
  }
}
${this.fragment()}`,
        { first: PAGE_SIZE, after, ...vars },
      );
      for (const e of data.posts.edges) yield e.node;
      if (!data.posts.pageInfo.hasNextPage || !data.posts.pageInfo.endCursor)
        return;
      after = data.posts.pageInfo.endCursor;
    }
  }

  async post(ref: PostRef): Promise<RawPost | null> {
    const byId = "id" in ref;
    const data: { post: RawPost | null } = await this.gql(
      () =>
        `query Post($key: ${byId ? "ID" : "String"}!) {
  post(${byId ? "id" : "slug"}: $key) { ${this.postSelection()} }
}
${this.fragment()}`,
      { key: byId ? ref.id : ref.slug },
    );
    return data.post;
  }

  /** Top comments (most upvoted first) for a post, up to `max`. */
  async comments(postId: string, max: number): Promise<Comment[]> {
    const out: Comment[] = [];
    let after: string | null = null;
    while (out.length < max) {
      const first = Math.min(PAGE_SIZE, max - out.length);
      const data: { post: { comments: Connection<RawComment> } | null } =
        await this.gql(
          () =>
            `query Comments($id: ID!, $first: Int!, $after: String) {
  post(id: $id) {
    comments(first: $first, after: $after${this.commentOrder ? ", order: VOTES_COUNT" : ""}) {
      pageInfo { hasNextPage endCursor }
      edges { node { ${this.fields.Comment.join(" ")} } }
    }
  }
}
${this.fragment()}`,
          { id: postId, first, after },
        );
      const conn = data.post?.comments;
      if (!conn) break;
      for (const e of conn.edges) out.push(toComment(e.node));
      if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
      after = conn.pageInfo.endCursor;
    }
    return out.slice(0, max);
  }
}
