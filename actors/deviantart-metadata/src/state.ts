/**
 * DeviantArt pages embed their Redux store as
 * `window.__INITIAL_STATE__ = JSON.parse("<JSON as a JS string literal>");`.
 */

const STATE_RE =
  /window\.__INITIAL_STATE__\s*=\s*JSON\.parse\("((?:[^"\\]|\\[\s\S])*)"\)/;

const SIMPLE_ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
  v: "\v",
  "0": "\0",
};

/** Decode the body of a double-quoted JS string literal. */
export function decodeJsString(s: string): string {
  return s.replace(
    /\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g,
    (_, e: string) => {
      if (e.length > 1) return String.fromCharCode(parseInt(e.slice(1), 16));
      return SIMPLE_ESCAPES[e] ?? e;
    },
  );
}

/** The page's initial state object, or null if the page has none. */
export function extractInitialState(
  html: string,
): Record<string, unknown> | null {
  const m = STATE_RE.exec(html);
  if (!m) return null;
  try {
    const v: unknown = JSON.parse(decodeJsString(m[1]!));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
