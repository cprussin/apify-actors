/**
 * Minimal XML reader for EDGAR Form D `primary_doc.xml` (plain elements and
 * text; attributes are ignored, namespace prefixes stripped).
 */
export interface XmlNode {
  name: string;
  text: string;
  children: XmlNode[];
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export const decodeEntities = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code =
        e[1] === "x" || e[1] === "X"
          ? parseInt(e.slice(2), 16)
          : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

const localName = (n: string): string => n.slice(n.indexOf(":") + 1);

/** Parse an XML document into its root element. Throws on garbage. */
export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: "#document", text: "", children: [] };
  const stack: XmlNode[] = [root];
  const re =
    /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)[^>]*?(\/?)>|([^<]+)/g;
  for (const m of xml.matchAll(re)) {
    const top = stack[stack.length - 1]!;
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2] !== undefined) {
      const name = localName(m[2]);
      // Tolerate stray closing tags; pop to the matching element.
      const idx = stack.map((n) => n.name).lastIndexOf(name);
      if (idx > 0) stack.length = idx;
    } else if (m[3] !== undefined) {
      const node: XmlNode = { name: localName(m[3]), text: "", children: [] };
      top.children.push(node);
      if (!m[4]) stack.push(node);
    } else if (m[5] !== undefined) top.text += decodeEntities(m[5]);
  }
  const el = root.children[0];
  if (!el) throw new Error("Not an XML document.");
  return el;
}

/** First descendant-by-path, e.g. child(n, "issuerAddress", "city"). */
export function child(
  node: XmlNode | undefined,
  ...path: string[]
): XmlNode | undefined {
  let cur = node;
  for (const p of path) {
    cur = cur?.children.find((c) => c.name === p);
    if (!cur) return undefined;
  }
  return cur;
}

export const children = (node: XmlNode | undefined, name: string): XmlNode[] =>
  node?.children.filter((c) => c.name === name) ?? [];

/** Trimmed text at path, or null when missing or empty. */
export function text(
  node: XmlNode | undefined,
  ...path: string[]
): string | null {
  const t = child(node, ...path)?.text.trim();
  return t ? t : null;
}
