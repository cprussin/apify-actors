import { address, categorize, dateOnly, pick, type Row } from "../record.js";
import { sourceFields, type StateAdapter } from "./types.js";

/**
 * Connecticut Secretary of the State, "Connecticut Business Registry -
 * Business Master". https://data.ct.gov/d/n7gp-d28j
 * `billing*` is the business address. Registered agents live in a separate
 * dataset (qh2m-n44y) and are not joined in v1.
 */
export const connecticut: StateAdapter = {
  code: "CT",
  stateName: "Connecticut",
  domain: "data.ct.gov",
  datasetId: "n7gp-d28j",
  datasetName: "Connecticut Business Registry - Business Master",
  dateField: "date_registration",
  idField: "accountnumber",
  nameField: "name",
  cityFields: ["billingcity"],
  zipFields: ["billingpostalcode"],
  baseWhere: "accountnumber IS NOT NULL",
  cadence: "daily",
  toRecord(row: Row) {
    const entityId = pick(row, "accountnumber");
    const name = pick(row, "name");
    if (!entityId || !name) return null;
    const entityType = pick(row, "business_type");
    return {
      ...sourceFields(connecticut, entityId),
      entityId,
      name,
      entityType,
      entityCategory: categorize(entityType),
      status: pick(row, "status"),
      formationDate: dateOnly(row.date_registration),
      jurisdiction: pick(row, "state_or_territory_formation", "citizenship"),
      county: null,
      principalAddress: address(row, {
        street: ["billingstreet"],
        city: ["billingcity"],
        state: ["billingstate"],
        zip: ["billingpostalcode"],
      }),
      mailingAddress: null,
      registeredAgentName: null,
      registeredAgentAddress: null,
    };
  },
};
