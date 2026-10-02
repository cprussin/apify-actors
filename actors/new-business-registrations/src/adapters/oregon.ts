import {
  address,
  categorize,
  dateOnly,
  joinName,
  pick,
  type BusinessRecord,
  type Row,
} from "../record.js";
import { soqlString } from "../socrata.js";
import { sourceFields, type QueryClient, type StateAdapter } from "./types.js";

const PRINCIPAL = "PRINCIPAL PLACE OF BUSINESS";
const MAILING = "MAILING ADDRESS";
const AGENT = "REGISTERED AGENT";
const ENRICH_BATCH = 100;

const orAddress = (row: Row) =>
  address(row, {
    street: ["address"],
    street2: ["address_continued"],
    city: ["city"],
    state: ["state"],
    zip: ["zip", "zip_code"],
  });

/**
 * Oregon Secretary of State, "Active Businesses - ALL".
 * https://data.oregon.gov/d/tckn-sxa6
 * Published weekly, active entities only. One row per associated name
 * (principal place of business, mailing address, registered agent, officers),
 * so the main query keeps principal-place rows and `enrich` fetches the
 * mailing and agent rows for each page. Assumed business names (DBAs) and
 * reserved names are excluded.
 */
export const oregon: StateAdapter = {
  code: "OR",
  stateName: "Oregon",
  domain: "data.oregon.gov",
  datasetId: "tckn-sxa6",
  datasetName: "Active Businesses - ALL",
  dateField: "registry_date",
  idField: "registry_number",
  nameField: "business_name",
  cityFields: ["city"],
  zipFields: ["zip"],
  baseWhere: `associated_name_type = ${soqlString(PRINCIPAL)} AND entity_type not in ('ASSUMED BUSINESS NAME', 'RESERVED NAME')`,
  cadence: "weekly",
  toRecord(row: Row) {
    const entityId = pick(row, "registry_number");
    const name = pick(row, "business_name");
    if (!entityId || !name) return null;
    const entityType = pick(row, "entity_type");
    return {
      ...sourceFields(oregon, entityId),
      entityId,
      name,
      entityType,
      entityCategory: categorize(entityType),
      status: "Active",
      formationDate: dateOnly(row.registry_date),
      jurisdiction: pick(row, "jurisdiction"),
      county: null,
      principalAddress: orAddress(row),
      mailingAddress: null,
      registeredAgentName: null,
      registeredAgentAddress: null,
    };
  },
  async enrich(records: BusinessRecord[], client: QueryClient) {
    const byId = new Map(records.map((r) => [r.entityId, r]));
    const ids = [...byId.keys()];
    for (let i = 0; i < ids.length; i += ENRICH_BATCH) {
      const batch = ids.slice(i, i + ENRICH_BATCH);
      const rows = await client.query(oregon.domain, oregon.datasetId, {
        where:
          `registry_number in (${batch.map(soqlString).join(", ")})` +
          ` AND associated_name_type in (${soqlString(MAILING)}, ${soqlString(AGENT)})`,
        limit: batch.length * 10,
      });
      for (const row of rows) {
        const rec = byId.get(pick(row, "registry_number") ?? "");
        if (!rec) continue;
        const kind = pick(row, "associated_name_type");
        if (kind === MAILING && !rec.mailingAddress) {
          rec.mailingAddress = orAddress(row);
        } else if (kind === AGENT && !rec.registeredAgentName) {
          rec.registeredAgentName =
            pick(row, "entity_of_record_name", "not_of_record_entity") ??
            joinName(
              pick(row, "first_name"),
              pick(row, "middle_name"),
              pick(row, "last_name"),
              pick(row, "suffix"),
            );
          rec.registeredAgentAddress = orAddress(row);
        }
      }
    }
  },
};
