import { address, categorize, dateOnly, pick, type Row } from "../record.js";
import { sourceFields, type StateAdapter } from "./types.js";

/** Comptroller organizational type codes seen for SOS-registered entities. */
export const TX_ORG_TYPES: Record<string, string> = {
  CL: "Texas Limited Liability Company",
  CI: "Foreign Limited Liability Company",
  CT: "Texas Profit Corporation",
  CF: "Foreign Profit Corporation",
};

/**
 * Texas Comptroller, "Active Franchise Tax Permit Holders".
 * https://data.texas.gov/d/9cir-efmm
 * Carries the Secretary of State file number and charter date. The address is
 * the taxpayer mailing address; there is no registered agent or county name.
 * Entities appear roughly 10 days after formation.
 */
export const texas: StateAdapter = {
  code: "TX",
  stateName: "Texas",
  domain: "data.texas.gov",
  datasetId: "9cir-efmm",
  datasetName: "Active Franchise Tax Permit Holders",
  dateField: "sos_charter_date",
  idField: "secretary_of_state_sos_or_coa_file_number",
  nameField: "taxpayer_name",
  cityFields: ["taxpayer_city"],
  zipFields: ["taxpayer_zip"],
  baseWhere: "secretary_of_state_sos_or_coa_file_number IS NOT NULL",
  cadence: "weekly",
  toRecord(row: Row) {
    const entityId = pick(row, "secretary_of_state_sos_or_coa_file_number");
    const name = pick(row, "taxpayer_name");
    if (!entityId || !name) return null;
    const code = pick(row, "taxpayer_organizational_type");
    const entityType = (code && TX_ORG_TYPES[code.toUpperCase()]) ?? code;
    const status = pick(row, "sos_status_code");
    return {
      ...sourceFields(texas, entityId),
      entityId,
      name,
      entityType,
      entityCategory: categorize(entityType),
      status: status === "A" ? "Active" : status,
      formationDate: dateOnly(row.sos_charter_date),
      jurisdiction: null,
      county: null,
      principalAddress: null,
      mailingAddress: address(row, {
        street: ["taxpayer_address"],
        city: ["taxpayer_city"],
        state: ["taxpayer_state"],
        zip: ["taxpayer_zip"],
      }),
      registeredAgentName: null,
      registeredAgentAddress: null,
    };
  },
};
