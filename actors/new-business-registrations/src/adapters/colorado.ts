import {
  address,
  categorize,
  dateOnly,
  joinName,
  pick,
  type Row,
} from "../record.js";
import { sourceFields, type StateAdapter } from "./types.js";

/**
 * Colorado Department of State, "Business Entities in Colorado".
 * https://data.colorado.gov/Business/Business-Entities-in-Colorado/4ykn-tg5h
 * One row per entity; no county field. `jurisdictonofformation` is spelled
 * that way in the dataset.
 */
export const colorado: StateAdapter = {
  code: "CO",
  stateName: "Colorado",
  domain: "data.colorado.gov",
  datasetId: "4ykn-tg5h",
  datasetName: "Business Entities in Colorado",
  dateField: "entityformdate",
  idField: "entityid",
  nameField: "entityname",
  cityFields: ["principalcity"],
  zipFields: ["principalzipcode"],
  cadence: "daily",
  toRecord(row: Row) {
    const entityId = pick(row, "entityid");
    const name = pick(row, "entityname");
    if (!entityId || !name) return null;
    const entityType = pick(row, "entitytype");
    return {
      ...sourceFields(colorado, entityId),
      entityId,
      name,
      entityType,
      entityCategory: categorize(entityType, pick(row, "entitytypeverbatim")),
      status: pick(row, "entitystatus"),
      formationDate: dateOnly(row.entityformdate),
      jurisdiction: pick(row, "jurisdictonofformation"),
      county: null,
      principalAddress: address(row, {
        street: ["principaladdress1"],
        street2: ["principaladdress2"],
        city: ["principalcity"],
        state: ["principalstate"],
        zip: ["principalzipcode"],
        country: ["principalcountry"],
      }),
      mailingAddress: address(row, {
        street: ["mailingaddress1"],
        street2: ["mailingaddress2"],
        city: ["mailingcity"],
        state: ["mailingstate"],
        zip: ["mailingzipcode"],
        country: ["mailingcountry"],
      }),
      registeredAgentName:
        pick(row, "agentorganizationname") ??
        joinName(
          pick(row, "agentfirstname"),
          pick(row, "agentmiddlename"),
          pick(row, "agentlastname"),
          pick(row, "agentsuffix"),
        ),
      registeredAgentAddress:
        address(row, {
          street: ["agentprincipaladdress1"],
          street2: ["agentprincipaladdress2"],
          city: ["agentprincipalcity"],
          state: ["agentprincipalstate"],
          zip: ["agentprincipalzipcode"],
          country: ["agentprincipalcountry"],
        }) ??
        address(row, {
          street: ["agentmailingaddress1"],
          street2: ["agentmailingaddress2"],
          city: ["agentmailingcity"],
          state: ["agentmailingstate"],
          zip: ["agentmailingzipcode"],
          country: ["agentmailingcountry"],
        }),
    };
  },
};
