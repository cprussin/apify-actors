export const DOC_TYPES = [
  "pdf",
  "docx",
  "pptx",
  "xlsx",
  "html",
  "epub",
  "csv",
  "txt",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export type Detection = { type: DocType } | { type: null; error: string };

const EXT: Record<string, DocType> = {
  pdf: "pdf",
  docx: "docx",
  pptx: "pptx",
  xlsx: "xlsx",
  html: "html",
  htm: "html",
  xhtml: "html",
  epub: "epub",
  csv: "csv",
  txt: "txt",
  md: "txt",
  markdown: "txt",
};

const MIME: Record<string, DocType> = {
  "application/pdf": "pdf",
  "application/x-pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/html": "html",
  "application/xhtml+xml": "html",
  "application/epub+zip": "epub",
  "text/csv": "csv",
  "text/plain": "txt",
  "text/markdown": "txt",
};

const BINARY = new Set<DocType>(["pdf", "docx", "pptx", "xlsx", "epub"]);

const LEGACY_OFFICE =
  "Legacy Office format (.doc, .xls or .ppt) is not supported. Save it as .docx, .xlsx or .pptx.";

/** Lower-case extension of a file name or URL path, without the dot. */
export function extensionOf(nameOrUrl: string | null | undefined): string {
  if (!nameOrUrl) return "";
  let path = nameOrUrl;
  try {
    path = new URL(nameOrUrl).pathname;
  } catch {
    // Not a URL: a plain file name.
  }
  const m = /\.([a-z0-9]{1,10})$/i.exec(path);
  return m ? m[1]!.toLowerCase() : "";
}

export const mimeOf = (contentType: string | null | undefined): string =>
  (contentType ?? "").split(";")[0]!.trim().toLowerCase();

/** Charset parameter of a Content-Type header, if any. */
export function charsetOf(
  contentType: string | null | undefined,
): string | null {
  const m = /charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType ?? "");
  return m ? m[1]!.toLowerCase() : null;
}

const startsWith = (buf: Buffer, sig: number[]) =>
  buf.length >= sig.length && sig.every((b, i) => buf[i] === b);

/** True if the first bytes look like text (no NUL bytes, few control chars). */
function looksLikeText(buf: Buffer): boolean {
  const head = buf.subarray(0, 4096);
  if (!head.length) return false;
  let bad = 0;
  for (const b of head) {
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) bad += 1;
  }
  return bad / head.length < 0.02;
}

/**
 * The document type, from magic bytes first, then Content-Type and the file
 * extension. ZIP containers are told apart by their entry names (OOXML part
 * names and the EPUB mimetype entry are stored uncompressed in the headers).
 */
export function detectType(
  body: Buffer,
  contentType: string | null | undefined,
  nameOrUrl: string | null | undefined,
): Detection {
  if (!body.length) return { type: null, error: "The file is empty." };
  const ext = EXT[extensionOf(nameOrUrl)];
  const mime = MIME[mimeOf(contentType)];

  if (body.subarray(0, 1024).includes("%PDF-")) return { type: "pdf" };

  if (startsWith(body, [0x50, 0x4b, 0x03, 0x04])) {
    const head = body.subarray(0, 200).toString("latin1");
    if (head.includes("mimetypeapplication/epub+zip")) return { type: "epub" };
    const names = body.toString("latin1");
    if (names.includes("word/document")) return { type: "docx" };
    if (names.includes("ppt/presentation")) return { type: "pptx" };
    if (names.includes("xl/workbook")) return { type: "xlsx" };
    if (names.includes("META-INF/container.xml")) return { type: "epub" };
    const hint = ext ?? mime;
    if (hint && ["docx", "pptx", "xlsx", "epub"].includes(hint))
      return { type: hint };
    return {
      type: null,
      error:
        "Unsupported file type: a ZIP archive that is not a DOCX, PPTX, XLSX or EPUB document.",
    };
  }

  if (startsWith(body, [0xd0, 0xcf, 0x11, 0xe0]))
    return { type: null, error: LEGACY_OFFICE };
  if (
    startsWith(body, [0x89, 0x50, 0x4e, 0x47]) ||
    startsWith(body, [0xff, 0xd8, 0xff])
  )
    return {
      type: null,
      error: "Unsupported file type: an image. Only documents are converted.",
    };

  if (!looksLikeText(body))
    return {
      type: null,
      error: `Unsupported file type${contentType ? ` (${mimeOf(contentType)})` : ""}. Supported: PDF, DOCX, PPTX, XLSX, HTML, EPUB, CSV, TXT.`,
    };

  const start = body
    .subarray(0, 2048)
    .toString("utf8")
    .trimStart()
    .toLowerCase();
  if (
    start.startsWith("<!doctype html") ||
    start.startsWith("<html") ||
    /<html[\s>]/.test(start)
  ) {
    // e.g. a .pdf link that answers with a login or error page.
    if (ext && BINARY.has(ext))
      return {
        type: null,
        error: `Expected a ${ext.toUpperCase()} file, but the server returned an HTML page (a login, paywall or error page?).`,
      };
    return { type: "html" };
  }
  for (const t of [ext, mime])
    if (t === "html" || t === "csv" || t === "txt") return { type: t };
  if (!ext && !mime) return { type: "txt" };
  return {
    type: null,
    error: `Unsupported file type (${mimeOf(contentType) || extensionOf(nameOrUrl)}). Supported: PDF, DOCX, PPTX, XLSX, HTML, EPUB, CSV, TXT.`,
  };
}
