/**
 * Minimal robots.txt (RFC 9309) matcher: groups by user agent, Allow and
 * Disallow with `*` and `$`, longest match wins, Allow wins ties.
 */
export interface Rule {
  allow: boolean;
  pattern: string;
}

export class Robots {
  constructor(private readonly rules: Rule[]) {}

  /** Robots that allow everything (no robots.txt or a 4xx). */
  static allowAll(): Robots {
    return new Robots([]);
  }

  /** Robots that disallow everything (robots.txt unreachable or 5xx). */
  static disallowAll(): Robots {
    return new Robots([{ allow: false, pattern: "/" }]);
  }

  /**
   * Parses robots.txt for `agent` (a product token, case-insensitive).
   * Uses the groups naming the agent, or the `*` groups when none do.
   */
  static parse(txt: string, agent = "*"): Robots {
    const groups: { agents: string[]; rules: Rule[] }[] = [];
    let current: { agents: string[]; rules: Rule[] } | null = null;
    let lastWasAgent = false;
    for (const raw of txt.replace(/^\ufeff/, "").split(/\r\n|\r|\n/)) {
      const line = raw.replace(/#.*$/, "").trim();
      const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
      if (!m) continue;
      const key = m[1]!.toLowerCase();
      const value = m[2]!.trim();
      if (key === "user-agent") {
        if (!current || !lastWasAgent) {
          current = { agents: [], rules: [] };
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
        if (!value) continue;
        current.rules.push({ allow: key === "allow", pattern: value });
      }
    }
    const a = agent.toLowerCase();
    const named = groups.filter((g) => a !== "*" && g.agents.includes(a));
    const chosen = named.length
      ? named
      : groups.filter((g) => g.agents.includes("*"));
    return new Robots(chosen.flatMap((g) => g.rules));
  }

  /** Whether `pathAndQuery` (e.g. "/impressum?x=1") may be fetched. */
  isAllowed(pathAndQuery: string): boolean {
    const path = normalizePath(pathAndQuery);
    if (path === "/robots.txt") return true;
    let best: Rule | null = null;
    let bestLen = -1;
    for (const r of this.rules) {
      if (!matches(r.pattern, path)) continue;
      const len = r.pattern.length;
      if (len > bestLen || (len === bestLen && r.allow)) {
        best = r;
        bestLen = len;
      }
    }
    return best ? best.allow : true;
  }
}

function normalizePath(p: string): string {
  let path = p || "/";
  if (!path.startsWith("/")) path = `/${path}`;
  // Compare percent-encoded forms consistently.
  try {
    path = encodeURI(decodeURI(path));
  } catch {
    // Keep as is.
  }
  return path;
}

const patternCache = new Map<string, RegExp>();

function matches(pattern: string, path: string): boolean {
  let re = patternCache.get(pattern);
  if (!re) {
    const anchored = pattern.endsWith("$");
    const body = normalizePath(anchored ? pattern.slice(0, -1) : pattern)
      .split("*")
      .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    re = new RegExp(`^${body}${anchored ? "$" : ""}`);
    patternCache.set(pattern, re);
  }
  return re.test(path);
}
