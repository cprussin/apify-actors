/** Larger bodies are cut: an Impressum fits in far less. */
export const MAX_BODY_BYTES = 3_000_000;

const ALIASES: Record<string, string> = {
  "iso-8859-1": "windows-1252",
  latin1: "windows-1252",
  "us-ascii": "windows-1252",
  ascii: "windows-1252",
};

/** Charset from a Content-Type value or the page's <meta> tags. */
export function sniffCharset(
  contentType: string | null | undefined,
  head: string,
): string | null {
  const fromHeader = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? "");
  if (fromHeader) return fromHeader[1]!.toLowerCase();
  const meta =
    /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head) ??
    /<\?xml[^>]+encoding\s*=\s*["']([\w.:-]+)/i.exec(head);
  return meta ? meta[1]!.toLowerCase() : null;
}

/**
 * Decodes a response body: header charset, then <meta charset>, then UTF-8
 * (falling back to Windows-1252 when the bytes aren't valid UTF-8, as on many
 * older German sites).
 */
export function decodeBody(
  buf: Uint8Array,
  contentType?: string | null,
): string {
  const bytes =
    buf.byteLength > MAX_BODY_BYTES ? buf.subarray(0, MAX_BODY_BYTES) : buf;
  const head = new TextDecoder("windows-1252").decode(bytes.subarray(0, 4096));
  const cs = sniffCharset(contentType, head);
  const label = cs ? (ALIASES[cs] ?? cs) : null;
  if (label && label !== "utf-8" && label !== "utf8") {
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // Unknown label: fall through to UTF-8.
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return cs
      ? new TextDecoder("utf-8").decode(bytes)
      : new TextDecoder("windows-1252").decode(bytes);
  }
}
