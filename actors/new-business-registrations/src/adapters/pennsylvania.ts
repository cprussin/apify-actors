import { address, categorize, dateOnly, pick, type Row } from "../record.js";
import { sourceFields, type StateAdapter } from "./types.js";

/**
 * Pennsylvania Department of State, "Registered Business Entities".
 * https://data.pa.gov/d/xvd7-5r2c
 * Refreshed monthly. One row per organizer/incorporator, so the runner
 * collapses rows by filing number. No status or registered agent.
 */
export const pennsylvania: StateAdapter = {
  code: "PA",
  stateName: "Pennsylvania",
  domain: "data.pa.gov",
  datasetId: "xvd7-5r2c",
  datasetName: "Registered Business Entities",
  dateField: "creationdate",
  idField: "filing_number",
  nameField: "business_name",
  cityFields: ["city"],
  zipFields: ["zip"],
  countyField: "shortcountyname",
  cadence: "monthly",
  toRecord(row: Row) {
    const entityId = pick(row, "filing_number");
    const name = pick(row, "business_name");
    if (!entityId || !name) return null;
    const entityType = pick(row, "typeofbusinessregistration");
    return {
      ...sourceFields(pennsylvania, entityId),
      entityId,
      name,
      entityType,
      entityCategory: categorize(entityType),
      status: null,
      formationDate: dateOnly(row.creationdate),
      jurisdiction: null,
      county: pick(row, "shortcountyname"),
      principalAddress: address(row, {
        street: ["address_line1"],
        street2: ["address_line2"],
        city: ["city"],
        state: ["state"],
        zip: ["zip"],
      }),
      mailingAddress: null,
      registeredAgentName: null,
      registeredAgentAddress: null,
    };
  },
};
