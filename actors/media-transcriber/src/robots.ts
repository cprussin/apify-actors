/**
 * Minimal robots.txt (RFC 9309) matcher: groups by user agent, Allow and
 * Disallow with `*` and `$`, longest match wins, Allow wins ties.
 */
export interface Rule {
  allow: boolean;
  pattern: string;
}

interface Group {
  agents: string[];
  rules: Rule[];
  crawlDelay: number | null;
}

/** Product tokens of Anthropic's crawlers ("ClaudeBot", "Claude-User", "anthropic-ai"...). */
export const CLAUDE_AGENT_RE = /claude|anthropic/i;

export class Robots {
  private readonly compiled: { allow: boolean; len: number; re: RegExp }[];

  constructor(
    rules: Rule[],
    /** Crawl-delay of the `*` group, in seconds. */
    readonly crawlDelay: number | null = null,
    /** User agents of groups that name a Claude crawler. */
    readonly claudeAgents: string[] = [],
  ) {
    this.compiled = rules.map((r) => ({
      allow: r.allow,
      len: r.pattern.length,
      re: compile(r.pattern),
    }));
  }

  get ruleCount(): number {
    return this.compiled.length;
  }

  /** No robots.txt (a clean 404): everything allowed. */
  static allowAll(): Robots {
    return new Robots([]);
  }

  /** Parses robots.txt and keeps the `*` group(s). */
  static parse(txt: string): Robots {
    const groups: Group[] = [];
    let current: Group | null = null;
    let lastWasAgent = false;
    for (const raw of txt.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/)) {
      const hash = raw.indexOf("#");
      const line = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
      if (!line) continue;
      const colon = line.indexOf(":");
      if (colon <= 0) continue;
      const key = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      if (key === "user-agent") {
        if (!current || !lastWasAgent) {
          current = { agents: [], rules: [], crawlDelay: null };
          groups.push(current);
        }
        current.agents.push(value.toLowerCase());
        lastWasAgent = true;
        continue;
      }
      lastWasAgent = false;
      if (!current) continue;
      if (key === "allow" || key === "disallow") {
        // An empty Disallow allows everything; an empty Allow means nothing.
        if (value)
          current.rules.push({ allow: key === "allow", pattern: value });
      } else if (key === "crawl-delay") {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
      }
    }
    const star = groups.filter((g) => g.agents.includes("*"));
    const delays = star
      .map((g) => g.crawlDelay)
      .filter((d): d is number => d !== null);
    return new Robots(
      star.flatMap((g) => g.rules),
      delays.length ? Math.max(...delays) : null,
      groups.flatMap((g) => g.agents.filter((a) => CLAUDE_AGENT_RE.test(a))),
    );
  }

  /** Whether `pathAndQuery` may be fetched under the `*` group. */
  isAllowed(pathAndQuery: string): boolean {
    const path = normalizePath(pathAndQuery);
    if (path === "/robots.txt") return true;
    let best: { allow: boolean; len: number } | null = null;
    for (const r of this.compiled) {
      if (best && (r.len < best.len || (r.len === best.len && !r.allow)))
        continue;
      if (r.re.test(path)) best = r;
    }
    return best ? best.allow : true;
  }
}

function normalizePath(p: string): string {
  let path = p || "/";
  if (!path.startsWith("/")) path = `/${path}`;
  try {
    path = encodeURI(decodeURI(path));
  } catch {
    // Keep as is.
  }
  return path;
}

function compile(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = normalizePath(anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}
