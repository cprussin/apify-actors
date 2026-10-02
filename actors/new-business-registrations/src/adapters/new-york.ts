import { address, categorize, dateOnly, pick, type Row } from "../record.js";
import { sourceFields, type StateAdapter } from "./types.js";

/**
 * New York Department of State, "Active Corporations: Beginning 1800".
 * https://data.ny.gov/Economic-Development/Active-Corporations-Beginning-1800/n9v6-gdp6
 * Active entities only, so status is always "Active". `location_*` is the
 * principal office (often blank for LLCs); `dos_process_*` is the address the
 * Department of State mails service of process to.
 */
export const newYork: StateAdapter = {
  code: "NY",
  stateName: "New York",
  domain: "data.ny.gov",
  datasetId: "n9v6-gdp6",
  datasetName: "Active Corporations: Beginning 1800",
  dateField: "initial_dos_filing_date",
  idField: "dos_id",
  nameField: "current_entity_name",
  cityFields: ["location_city", "dos_process_city"],
  zipFields: ["location_zip", "dos_process_zip"],
  countyField: "county",
  cadence: "daily",
  toRecord(row: Row) {
    const entityId = pick(row, "dos_id");
    const name = pick(row, "current_entity_name");
    if (!entityId || !name) return null;
    const entityType = pick(row, "entity_type");
    return {
      ...sourceFields(newYork, entityId),
      entityId,
      name,
      entityType,
      entityCategory: categorize(entityType),
      status: "Active",
      formationDate: dateOnly(row.initial_dos_filing_date),
      jurisdiction: pick(row, "jurisdiction"),
      county: pick(row, "county"),
      principalAddress: address(row, {
        street: ["location_address_1"],
        street2: ["location_address_2"],
        city: ["location_city"],
        state: ["location_state"],
        zip: ["location_zip"],
      }),
      mailingAddress: address(row, {
        street: ["dos_process_address_1"],
        street2: ["dos_process_address_2"],
        city: ["dos_process_city"],
        state: ["dos_process_state"],
        zip: ["dos_process_zip"],
      }),
      registeredAgentName: pick(row, "registered_agent_name"),
      registeredAgentAddress: address(row, {
        street: ["registered_agent_address_1"],
        street2: ["registered_agent_address_2"],
        city: ["registered_agent_city"],
        state: ["registered_agent_state"],
        zip: ["registered_agent_zip"],
      }),
    };
  },
};
