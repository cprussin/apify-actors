import type { AwardDetail, LocationObject, SearchRow } from "./usaspending.js";

export interface ContractRecord {
  awardId: string;
  piid: string | null;
  parentIdvPiid: string | null;
  recipientName: string | null;
  recipientUei: string | null;
  parentRecipientName: string | null;
  awardingAgency: string | null;
  awardingSubAgency: string | null;
  awardingOffice: string | null;
  contractType: string | null;
  naicsCode: string | null;
  naicsDescription: string | null;
  pscCode: string | null;
  pscDescription: string | null;
  description: string | null;
  setAsideType: string | null;
  setAsideDescription: string | null;
  extentCompeted: string | null;
  pricingType: string | null;
  numberOfOffers: number | null;
  obligatedAmount: number | null;
  outlayedAmount: number | null;
  currentValue: number | null;
  potentialValue: number | null;
  startDate: string | null;
  currentEndDate: string | null;
  potentialEndDate: string | null;
  daysUntilExpiry: number | null;
  placeOfPerformance: {
    city: string | null;
    county: string | null;
    state: string | null;
    zip: string | null;
    country: string | null;
  };
  lastModifiedDate: string | null;
  usaspendingUrl: string;
}

const str = (v: string | null | undefined): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
};

const num = (v: number | string | null | undefined): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Normalize "2027-03-31 00:00:00" / "2027-03-31T00:00:00Z" to "2027-03-31". */
export const dateOnly = (v: string | null | undefined): string | null => {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1]! : null;
};

export function daysBetween(fromIso: string, toIso: string): number {
  const ms =
    Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

const location = (
  loc: LocationObject | null | undefined,
): ContractRecord["placeOfPerformance"] => ({
  city: str(loc?.city_name),
  county: str(loc?.county_name),
  state: str(loc?.state_code),
  zip: str(loc?.zip5),
  country: str(loc?.location_country_code),
});

export const usaspendingUrl = (generatedId: string): string =>
  `https://www.usaspending.gov/award/${encodeURIComponent(generatedId)}`;

export function toContractRecord(
  row: SearchRow,
  detail: AwardDetail | null,
  today: string,
): ContractRecord {
  const tx = detail?.latest_transaction_contract_data ?? null;
  const pop = detail?.period_of_performance ?? null;
  const agency = detail?.awarding_agency ?? null;
  const currentEndDate = dateOnly(pop?.end_date) ?? dateOnly(row["End Date"]);
  const awardId =
    detail?.generated_unique_award_id ?? row.generated_internal_id;

  return {
    awardId,
    piid: str(detail?.piid) ?? str(row["Award ID"]),
    parentIdvPiid: str(detail?.parent_award?.piid),
    recipientName:
      str(detail?.recipient?.recipient_name) ?? str(row["Recipient Name"]),
    recipientUei:
      str(detail?.recipient?.recipient_uei) ?? str(row["Recipient UEI"]),
    parentRecipientName: str(detail?.recipient?.parent_recipient_name),
    awardingAgency:
      str(agency?.toptier_agency?.name) ?? str(row["Awarding Agency"]),
    awardingSubAgency:
      str(agency?.subtier_agency?.name) ?? str(row["Awarding Sub Agency"]),
    awardingOffice: str(agency?.office_agency_name),
    contractType:
      str(detail?.type_description) ?? str(row["Contract Award Type"]),
    naicsCode: str(tx?.naics) ?? str(row.NAICS?.code),
    naicsDescription: str(tx?.naics_description) ?? str(row.NAICS?.description),
    pscCode: str(tx?.product_or_service_code) ?? str(row.PSC?.code),
    pscDescription:
      str(tx?.product_or_service_description) ?? str(row.PSC?.description),
    description: str(detail?.description) ?? str(row.Description),
    setAsideType: str(tx?.type_set_aside),
    setAsideDescription: str(tx?.type_set_aside_description),
    extentCompeted: str(tx?.extent_competed_description),
    pricingType: str(tx?.type_of_contract_pricing_description),
    numberOfOffers: num(tx?.number_of_offers_received),
    obligatedAmount: num(detail?.total_obligation) ?? num(row["Award Amount"]),
    outlayedAmount: num(row["Total Outlays"]),
    currentValue: num(detail?.base_exercised_options),
    potentialValue: num(detail?.base_and_all_options),
    startDate: dateOnly(pop?.start_date) ?? dateOnly(row["Start Date"]),
    currentEndDate,
    potentialEndDate: dateOnly(pop?.potential_end_date),
    daysUntilExpiry: currentEndDate ? daysBetween(today, currentEndDate) : null,
    placeOfPerformance: location(
      detail?.place_of_performance ?? row["Primary Place of Performance"],
    ),
    lastModifiedDate:
      dateOnly(pop?.last_modified_date) ?? dateOnly(row["Last Modified Date"]),
    usaspendingUrl: usaspendingUrl(awardId),
  };
}
