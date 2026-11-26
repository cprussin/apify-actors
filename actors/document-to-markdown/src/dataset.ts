/**
 * Dataset chaining: document URLs read from another run's dataset (e.g. a
 * scraper's output) or from rows pasted into the input.
 */

/** Fields checked, in order, when no datasetField is given. */
export const DATASET_FIELDS = [
  "url",
  "pdfUrl",
  "documentUrl",
  "fileUrl",
  "downloadUrl",
  "mediaUrl",
  "imageUrl",
] as const;

/** Dataset ID or "username~dataset-name". */
export const DATASET_ID = /^[A-Za-z0-9_.-]+(?:~[A-Za-z0-9_.-]+)?$/;
/** A field name or dot path, like "pdfUrl" or "attachment.url". */
export const DATASET_FIELD = /^[A-Za-z0-9_$-]+(\.[A-Za-z0-9_$-]+)*$/;

/** Where a source came from: a dataset (null: pasted datasetItems) row. */
export interface DatasetOrigin {
  datasetId: string | null;
  /** 0-based row index; null when the whole dataset could not be read. */
  itemIndex: number | null;
}

/** One dataset row's document URL, or why it has none. */
export type DatasetRow =
  | { origin: DatasetOrigin; url: string }
  | { origin: DatasetOrigin; error: string };

const pickUrl = (x: unknown): string | null => {
  if (typeof x === "string") return x.trim() || null;
  if (Array.isArray(x)) {
    for (const y of x) {
      const u = pickUrl(y);
      if (u) return u;
    }
    return null;
  }
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    for (const k of ["url", "src", "href"])
      if (typeof o[k] === "string") return (o[k] as string).trim() || null;
  }
  return null;
};

const at = (item: unknown, path: string): unknown => {
  let v: unknown = item;
  for (const part of path.split(".")) {
    if (v === null || typeof v !== "object") return undefined;
    v = (v as Record<string, unknown>)[part];
  }
  return v;
};

/**
 * The document URL of one dataset row: a string row, the `field` (dot
 * path) when given, or else the first of DATASET_FIELDS that holds one.
 * Values can be strings, arrays (first URL) or objects with a url/src/href.
 */
export function urlFromRow(row: unknown, field: string | null): string | null {
  if (typeof row === "string") return row.trim() || null;
  if (field) return pickUrl(at(row, field));
  for (const f of DATASET_FIELDS) {
    const u = pickUrl(at(row, f));
    if (u) return u;
  }
  return null;
}

/** Rows -> URLs, or a free error per row without one. */
export function datasetRows(
  rows: unknown[],
  datasetId: string | null,
  field: string | null,
  start = 0,
): DatasetRow[] {
  const where = field
    ? `field "${field}"`
    : `any of ${DATASET_FIELDS.join(", ")}`;
  return rows.map((row, i) => {
    const origin = { datasetId, itemIndex: start + i };
    const url = urlFromRow(row, field);
    return url
      ? { origin, url }
      : {
          origin,
          error: `No document URL in dataset item ${start + i} (looked in ${where}; set datasetField).`,
        };
  });
}

/** Top-level fields to ask the API for (less data over the wire). */
export const apiFields = (field: string | null): string[] =>
  field ? [field.split(".")[0]!] : [...DATASET_FIELDS];
