export const ENTITY_CATEGORIES = [
  "llc",
  "corporation",
  "nonprofit",
  "partnership",
  "other",
] as const;
export type EntityCategory = (typeof ENTITY_CATEGORIES)[number];

export interface Address {
  street: string | null;
  street2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
}

/** One normalized business registration, identical across states. */
export interface BusinessRecord {
  state: string;
  entityId: string;
  name: string;
  entityType: string | null;
  entityCategory: EntityCategory;
  status: string | null;
  formationDate: string | null;
  jurisdiction: string | null;
  county: string | null;
  principalAddress: Address | null;
  mailingAddress: Address | null;
  registeredAgentName: string | null;
  registeredAgentAddress: Address | null;
  sourceUrl: string;
  sourceDataset: string;
}

export type Row = Record<string, unknown>;

export const str = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim().replace(/\s+/g, " ");
  return s ? s : null;
};

/** First non-empty value among the given row fields. */
export const pick = (row: Row, ...fields: string[]): string | null => {
  for (const f of fields) {
    const v = str(row[f]);
    if (v) return v;
  }
  return null;
};

/** Join non-empty name parts with single spaces. */
export const joinName = (...parts: (string | null)[]): string | null =>
  str(parts.filter(Boolean).join(" "));

/** "2026-09-01T00:00:00.000" / "2026-09-01" -> "2026-09-01". */
export const dateOnly = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1]! : null;
};

/** Build an address from row fields; null when every part is empty. */
export function address(
  row: Row,
  fields: {
    street?: string[];
    street2?: string[];
    city?: string[];
    state?: string[];
    zip?: string[];
    country?: string[];
  },
): Address | null {
  const a: Address = {
    street: pick(row, ...(fields.street ?? [])),
    street2: pick(row, ...(fields.street2 ?? [])),
    city: pick(row, ...(fields.city ?? [])),
    state: pick(row, ...(fields.state ?? [])),
    zip: pick(row, ...(fields.zip ?? [])),
    country: pick(row, ...(fields.country ?? [])),
  };
  const { country: _c, state: _s, ...core } = a;
  return Object.values(core).some(Boolean) ? a : null;
}

/** Collapse raw state-specific entity types into a small shared vocabulary. */
export function categorize(...rawTypes: (string | null)[]): EntityCategory {
  const t = rawTypes.filter(Boolean).join(" ").toUpperCase();
  if (!t) return "other";
  if (/NON-?PROFIT|NOT[- ]FOR[- ]PROFIT|NON-?STOCK|\b[DF]NC\b/.test(t))
    return "nonprofit";
  if (
    /PARTNERSHIP|\bL\.?L\.?L\.?P\b|\bL\.?L\.?P\b|\bL\.?P\b|\b[DF]L?LP\b/.test(t)
  )
    return "partnership";
  if (/LIMITED LIABILITY COMPANY|\bL\.?L\.?C\b|\b[DF]LLC\b|\bP?LLC\b/.test(t))
    return "llc";
  if (/CORPORATION|\bCORP\b|\bINC\b|\bSTOCK\b|\bPROFIT\b|\b[DF]PC\b/.test(t))
    return "corporation";
  return "other";
}
