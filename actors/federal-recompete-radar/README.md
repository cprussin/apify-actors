# Federal Recompete Radar: find expiring US government contracts

**Federal Recompete Radar** finds US federal contracts that are about to expire, so you can position for the recompete before the solicitation drops. It searches official [USAspending.gov](https://www.usaspending.gov) data for contracts whose **current period of performance ends in your chosen window** (for example, 6 to 18 months from today). You can filter by NAICS, PSC, agency, place of performance, set-aside and dollar value.

Each result names the incumbent contractor (with UEI), the contracting agency and office, the value, the current and potential end dates, and a link to the award on USAspending.

- ✅ No API key, login or proxy needed. The data is public.
- ✅ Contracts are returned soonest-expiring first.
- ✅ **Delta mode** returns only contracts you haven't seen yet, which suits weekly scheduled alerts.
- ✅ You pay per contract returned. Empty runs cost next to nothing.

## Who tracks expiring federal contracts?

- **Business development and capture teams** at government contractors fill their pipeline 12 to 18 months ahead of RFPs.
- **Small businesses (8(a), HUBZone, SDVOSB, WOSB)** find set-aside work coming up for recompete in their NAICS codes.
- **Teaming and subcontracting:** see who holds the incumbent contract and reach out before the recompete.
- **Market research and competitive intelligence:** track which competitors' contracts are about to roll off.
- **Consultants, proposal writers and GovCon newsletters** get a steady feed of leads.

## How does the federal recompete radar work?

1. Pick an expiry window in months from today, plus any filters you want.
2. The actor queries the USAspending.gov award search API for contract awards (types A, B, C and D), sorted by current end date. It jumps straight to the start of your window.
3. By default it also loads each award's detail record. That adds the potential end date (with all options exercised), the potential value, the set-aside type, the contracting office, the number of offers received and the PIID.
4. Results go to the dataset, and you can export them as JSON, CSV, Excel or through the API.

## How do I filter expiring federal contracts?

| Field                                 | Description                                                               | Example                              |
| ------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------ |
| `endsInMonthsMin` / `endsInMonthsMax` | Expiry window in months from today                                        | `6` / `18`                           |
| `naicsCodes`                          | NAICS codes (6 digits) or 2/4-digit prefixes                              | `["541512", "5415"]`                 |
| `pscCodes`                            | Product/Service Codes                                                     | `["DA01", "R425"]`                   |
| `keywords`                            | Free-text keywords                                                        | `["cloud migration"]`                |
| `awardTypes`                          | A = BPA call, B = PO, C = delivery order, D = definitive contract         | `["C", "D"]`                         |
| `awardingAgencies`                    | Top-tier agency names                                                     | `["Department of Veterans Affairs"]` |
| `awardingSubAgencies`                 | Sub-tier agency names                                                     | `["Department of the Army"]`         |
| `placeOfPerformanceStates`            | 2-letter state codes                                                      | `["VA", "MD", "DC"]`                 |
| `setAsideTypes`                       | FPDS set-aside codes                                                      | `["SBA", "8A", "SDVOSBC"]`           |
| `minAwardValue` / `maxAwardValue`     | Obligated amount range (USD)                                              | `1000000`                            |
| `minPotentialValue`                   | Minimum base-and-all-options value (USD)                                  | `5000000`                            |
| `maxResults`                          | Maximum number of contracts to return                                     | `100`                                |
| `includeDetails`                      | Load award detail records (recommended)                                   | `true`                               |
| `onlyNew`                             | Delta mode: skip contracts returned by earlier runs with the same filters | `true`                               |

Example input:

```json
{
  "endsInMonthsMin": 6,
  "endsInMonthsMax": 18,
  "naicsCodes": ["541512", "541519"],
  "awardingAgencies": ["Department of Veterans Affairs"],
  "setAsideTypes": ["SDVOSBC"],
  "minAwardValue": 1000000,
  "maxResults": 100,
  "onlyNew": true
}
```

## What data do you get for each expiring contract?

One dataset item per contract:

```json
{
  "awardId": "CONT_AWD_36C10B22C0001_3600_-NONE-_-NONE-",
  "piid": "36C10B22C0001",
  "parentIdvPiid": null,
  "recipientName": "ACME FEDERAL SOLUTIONS LLC",
  "recipientUei": "ABCDEF123456",
  "parentRecipientName": "ACME HOLDINGS INC",
  "awardingAgency": "Department of Veterans Affairs",
  "awardingSubAgency": "Veterans Affairs, Department of",
  "awardingOffice": "TECHNOLOGY ACQUISITION CENTER NJ (36C10B)",
  "contractType": "DEFINITIVE CONTRACT",
  "naicsCode": "541512",
  "naicsDescription": "COMPUTER SYSTEMS DESIGN SERVICES",
  "pscCode": "DA01",
  "pscDescription": "IT AND TELECOM - BUSINESS APPLICATION/APPLICATION DEVELOPMENT SUPPORT SERVICES (LABOR)",
  "description": "IT OPERATIONS AND MAINTENANCE SUPPORT SERVICES",
  "setAsideType": "SDVOSBC",
  "setAsideDescription": "SERVICE DISABLED VETERAN OWNED SMALL BUSINESS SET-ASIDE",
  "extentCompeted": "FULL AND OPEN COMPETITION",
  "pricingType": "FIRM FIXED PRICE",
  "numberOfOffers": 3,
  "obligatedAmount": 4250000.5,
  "outlayedAmount": 3100000,
  "currentValue": 5100000,
  "potentialValue": 8750000,
  "startDate": "2022-04-01",
  "currentEndDate": "2027-03-29",
  "potentialEndDate": "2029-03-31",
  "daysUntilExpiry": 181,
  "placeOfPerformance": {
    "city": "ARLINGTON",
    "county": "ARLINGTON",
    "state": "VA",
    "zip": "22201",
    "country": "USA"
  },
  "lastModifiedDate": "2026-08-14",
  "usaspendingUrl": "https://www.usaspending.gov/award/CONT_AWD_36C10B22C0001_3600_-NONE-_-NONE-"
}
```

(This is an illustrative record. Real values come from USAspending.)

**Field notes**

- `obligatedAmount` is the amount obligated so far. `currentValue` is the base plus exercised options. `potentialValue` is the base plus all options.
- `currentEndDate` is the end date as currently modified. `potentialEndDate` assumes every option is exercised. A contract whose potential end date is well past its current end date may be extended instead of recompeted.
- Detail-only fields (`potentialValue`, `potentialEndDate`, `setAsideType`, `awardingOffice` and similar) are `null` when `includeDetails` is off.

## How much does it cost to find federal recompetes?

This actor is priced **per result** (pay-per-event):

| Event                                     | Price     |
| ----------------------------------------- | --------- |
| Contract result (one item in the dataset) | **$0.01** |

For example, 100 contracts cost $1.00, and a weekly delta-mode alert that returns 20 new contracts costs about $0.20. If you set a **maximum cost per run**, the actor stops cleanly when it reaches that limit, so you never pay more than you set.

## Tips for finding federal recompete opportunities

- **Weekly alerts:** schedule the actor with `onlyNew: true` and connect it to email, Slack or Google Sheets through Apify integrations. Each run returns only newly surfaced contracts.
- **Agency names** must match USAspending exactly, for example "Department of Defense" or "Department of Homeland Security". Check spelling on usaspending.gov if you get zero results.
- **IDVs** (GWACs, IDIQs, BPAs themselves) aren't included. The actor covers the contract awards and task/delivery orders under them.
- The data comes from FPDS through USAspending and usually lags by a few days. DoD data is published with a 90-day delay.

## Federal recompete radar FAQ

**Is this data official?** Yes. It comes from USAspending.gov, the official source for federal spending data (DATA Act).

**Why is a contract missing?** Some awards are classified or unreported, and some are recorded under a different NAICS or PSC than you expect. Try broader NAICS prefixes or keywords.

**Can I use it through the API or with AI agents?** Yes. Call it through the Apify API, the MCP server or any Apify integration.

**Disclaimer:** This actor is not affiliated with USAspending.gov or the US Government. Always confirm opportunities on SAM.gov.

## Related actors

- [new-business-registrations](https://apify.com/cprussin/new-business-registrations?fpr=to54nm): New LLC and corporation filings from state open-data portals.
- [trustpilot-reviews](https://apify.com/cprussin/trustpilot-reviews?fpr=to54nm): Trustpilot reviews, ratings and TrustScore for any company.
