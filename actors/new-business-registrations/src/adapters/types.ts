import { addDays, type DateWindow } from "../dates.js";
import type { BusinessRecord, Row } from "../record.js";
import { resourceUrl, soqlString, type SocrataClient } from "../socrata.js";

export type QueryClient = Pick<SocrataClient, "query">;

/** Server-side filters every adapter supports (pushed into $where). */
export interface SearchFilters {
  cities: string[];
  zipCodes: string[];
  counties: string[];
  nameKeywords: string[];
}

/**
 * One state's registry dataset. Adding a state = one object implementing
 * this interface plus a fixture test. Field names are Socrata API field names.
 */
export interface StateAdapter {
  /** USPS state code. */
  code: string;
  stateName: string;
  domain: string;
  datasetId: string;
  datasetName: string;
  /** Formation / registration date field (Socrata floating timestamp). */
  dateField: string;
  /** Unique entity id field; also used for per-record source links. */
  idField: string;
  nameField: string;
  /** Fields matched (OR) by the city filter. */
  cityFields: string[];
  /** Fields matched (OR, prefix) by the ZIP filter. */
  zipFields: string[];
  /** County name field, if the dataset has one. */
  countyField?: string;
  /** Always-applied SoQL condition (e.g. drop DBAs, pick one row per entity). */
  baseWhere?: string;
  /** Typical publishing lag, shown in the README and logs. */
  cadence: string;
  /** Map one dataset row to the shared schema; null to skip the row. */
  toRecord(row: Row): BusinessRecord | null;
  /** Optional second query per page (e.g. agent/mailing rows in OR). */
  enrich?(records: BusinessRecord[], client: QueryClient): Promise<void>;
}

const upperIn = (field: string, values: string[]): string =>
  values.length === 1
    ? `upper(${field}) = ${soqlString(values[0]!)}`
    : `upper(${field}) in (${values.map(soqlString).join(", ")})`;

const anyOf = (parts: string[]): string =>
  parts.length === 1 ? parts[0]! : `(${parts.join(" OR ")})`;

/**
 * Build the $where clause for a formation-date window plus filters.
 * Returns null if a requested filter can't be applied to this dataset
 * (county filter on a dataset without counties), so the caller can skip it.
 */
export function buildWhere(
  adapter: StateAdapter,
  window: DateWindow,
  filters: SearchFilters,
): string | null {
  const parts = [
    `${adapter.dateField} >= ${soqlString(`${window.from}T00:00:00`)}`,
    `${adapter.dateField} < ${soqlString(`${addDays(window.to, 1)}T00:00:00`)}`,
  ];
  if (adapter.baseWhere) parts.push(`(${adapter.baseWhere})`);
  if (filters.cities.length) {
    parts.push(
      anyOf(adapter.cityFields.map((f) => upperIn(f, filters.cities))),
    );
  }
  if (filters.zipCodes.length) {
    parts.push(
      anyOf(
        adapter.zipFields.flatMap((f) =>
          filters.zipCodes.map((z) => `${f} like ${soqlString(`${z}%`)}`),
        ),
      ),
    );
  }
  if (filters.counties.length) {
    if (!adapter.countyField) return null;
    parts.push(
      anyOf(
        filters.counties.map(
          (c) => `upper(${adapter.countyField}) like ${soqlString(`${c}%`)}`,
        ),
      ),
    );
  }
  if (filters.nameKeywords.length) {
    parts.push(
      anyOf(
        filters.nameKeywords.map(
          (k) =>
            `upper(${adapter.nameField}) like ${soqlString(`%${k.replace(/[%_]/g, "")}%`)}`,
        ),
      ),
    );
  }
  return parts.join(" AND ");
}

/** Newest first; `:id` makes offset paging stable across equal dates. */
export const orderBy = (adapter: StateAdapter): string =>
  `${adapter.dateField} DESC, :id`;

/** API link that returns exactly this entity's row(s). */
export const recordUrl = (adapter: StateAdapter, entityId: string): string =>
  resourceUrl(adapter.domain, adapter.datasetId, {
    where: `${adapter.idField} = ${soqlString(entityId)}`,
  });

export const datasetLabel = (adapter: StateAdapter): string =>
  `${adapter.domain}/${adapter.datasetId} (${adapter.datasetName})`;

/** Fields every record gets from its adapter. */
export const sourceFields = (
  adapter: StateAdapter,
  entityId: string,
): Pick<BusinessRecord, "state" | "sourceUrl" | "sourceDataset"> => ({
  state: adapter.code,
  sourceUrl: recordUrl(adapter, entityId),
  sourceDataset: datasetLabel(adapter),
});
