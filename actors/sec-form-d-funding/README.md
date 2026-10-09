# SEC Form D Scraper: startup funding rounds and private placements from EDGAR

**SEC Form D Funding** returns new **Form D** filings from SEC EDGAR. Companies and funds must file a Form D within 15 days of the first sale in a Regulation D private placement, so this is the earliest public record of most US **startup funding rounds** and **fundraising**: seed and venture rounds, SAFEs, real estate syndications, and private equity, hedge and VC funds. Each filing comes back as one clean JSON record with the issuer, contact details, amount offered and sold, number of investors, exemptions claimed (506(b), 506(c)) and the executives and directors behind it.

- ✅ **Official SEC data**, read straight from EDGAR. No login, CAPTCHA, proxy or API key needed.
- ✅ **Every Form D field that matters**, parsed from each filing's XML. Not just the search-index summary.
- ✅ Filter by **filing date, issuer state, industry group, offering size** and **new vs. amended** filings, or **exclude investment funds** to keep only operating companies.
- ✅ **Delta mode** returns only filings you haven't received yet, which suits a daily "recently funded" feed.
- ✅ You pay per filing returned. Empty runs cost next to nothing.

## Who uses SEC Form D data?

- **B2B sales teams** (SaaS, banking, payroll, HR, recruiting, office space) contact startups right after they raise money and have budget to spend.
- **VCs, angels and analysts** track competitors' rounds, new funds and deal flow by industry or state.
- **Lawyers, accountants and fund administrators** find new funds and issuers that need services.
- **Journalists and researchers** monitor private-market fundraising in near real time.
- **Data teams** build a free alternative to Crunchbase-style funding feeds and enrich CRMs with official filings.

## How does the Form D scraper work?

1. Pick a filing-date window (default: the last 7 days) and any filters.
2. The actor searches EDGAR full-text search for Form D and D/A filings one day at a time, newest first. Issuer-state and filing-type filters run on the server.
3. For each filing it downloads the official `primary_doc.xml` and parses every field into one flat record.
4. Industry, fund and offering-size filters are applied, and matching filings are saved to the dataset.
5. With `onlyNew`, filings already delivered by earlier runs with the same filters are skipped (and not charged).

The actor follows the [SEC's fair-access policy](https://www.sec.gov/os/accessing-edgar-data): it sends a declared User-Agent, stays under 10 requests per second and backs off on HTTP 429/503. It processes about 7 filings per second.

## How do I filter Form D filings?

| Field                                     | Description                                                                              | Example                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------- |
| `lastNDays`                               | Filed in the last N calendar days, including today (UTC)                                 | `7`                               |
| `startDate` / `endDate`                   | Exact filing-date range (YYYY-MM-DD); `startDate` overrides `lastNDays`                  | `"2026-09-01"`                    |
| `states`                                  | Two-letter codes of the issuer's business address state (empty = all)                    | `["CA", "NY", "TX"]`              |
| `industryGroups`                          | Form D industry groups or whole categories (empty = all)                                 | `["Technology", "Biotechnology"]` |
| `excludeInvestmentFunds`                  | Skip pooled investment funds (hedge, PE, VC funds, SPVs), which file over half of all Ds | `true`                            |
| `minOfferingAmount` / `maxOfferingAmount` | Total offering size in USD. "Indefinite" offerings pass a minimum and fail a maximum     | `1000000`                         |
| `filingType`                              | `both`, `new` (Form D) or `amendment` (Form D/A)                                         | `"new"`                           |
| `maxResults`                              | Maximum filings to return                                                                | `100`                             |
| `onlyNew`                                 | Delta mode: skip filings returned by earlier runs with the same filters                  | `true`                            |

Industry categories: Agriculture, Banking & Financial Services, Business Services, Energy, Health Care, Manufacturing, Real Estate, Retailing, Restaurants, Technology, Travel, Other. Each has groups such as Computers, Telecommunications, Other Technology, Biotechnology, Pharmaceuticals, Oil and Gas, Residential or Pooled Investment Fund.

Example input, a daily feed of new startup rounds of $1M or more in California and New York:

```json
{
  "lastNDays": 3,
  "states": ["CA", "NY"],
  "excludeInvestmentFunds": true,
  "minOfferingAmount": 1000000,
  "filingType": "new",
  "maxResults": 500,
  "onlyNew": true
}
```

## What data do you get for each Form D filing?

One dataset item per filing:

```json
{
  "issuerName": "Acme Robotics, Inc.",
  "cik": "2012345",
  "accessionNumber": "0002012345-26-000001",
  "formType": "D",
  "filingDate": "2026-10-08",
  "isAmendment": false,
  "previousAccessionNumber": null,
  "entityType": "Corporation",
  "yearOfIncorporation": 2024,
  "incorporatedWithinFiveYears": true,
  "stateOfIncorporation": "DELAWARE",
  "address": {
    "street": "100 Market Street",
    "street2": "Suite 300",
    "city": "SAN FRANCISCO",
    "state": "CA",
    "stateName": "CALIFORNIA",
    "zip": "94105"
  },
  "phone": "415-555-0100",
  "industryGroup": "Other Technology",
  "industryCategory": "Technology",
  "investmentFundType": null,
  "revenueRange": "Decline to Disclose",
  "securityTypes": ["Equity"],
  "dateOfFirstSale": "2026-09-30",
  "totalOfferingAmount": 5000000,
  "offeringAmountIndefinite": false,
  "totalAmountSold": 3250000,
  "totalRemaining": 1750000,
  "minimumInvestment": 25000,
  "totalInvestors": 12,
  "nonAccreditedInvestors": 0,
  "salesCommissions": 0,
  "findersFees": 0,
  "exemptions": ["06b"],
  "relatedPersons": [
    {
      "name": "Jane Q Founder",
      "roles": ["Executive Officer", "Director"],
      "title": "CEO",
      "city": "San Francisco",
      "state": "CA"
    }
  ],
  "salesRecipients": [],
  "otherIssuers": [],
  "filingUrl": "https://www.sec.gov/Archives/edgar/data/2012345/000201234526000001/0002012345-26-000001-index.htm",
  "xmlUrl": "https://www.sec.gov/Archives/edgar/data/2012345/000201234526000001/primary_doc.xml"
}
```

(This is an illustrative record.)

**Field notes**

- `totalAmountSold` is the amount raised so far. `totalOfferingAmount` is the target. Funds often report the offering as Indefinite (`offeringAmountIndefinite: true`, amount `null`).
- `exemptions` uses the SEC's codes: `06b` = Rule 506(b), `06c` = Rule 506(c) (general solicitation allowed), `04` = Rule 504, `3C`, `3C.1`, `3C.7` = Investment Company Act 3(c) exclusions used by funds, `4a5` = Section 4(a)(5).
- `relatedPersons` lists executive officers, directors and promoters with their city and state. Form D does not include emails or investor names.
- `salesRecipients` lists placement agents and brokers paid commissions, with their FINRA CRD numbers.
- Amendments (`D/A`) update earlier notices, for example with a higher amount sold. `previousAccessionNumber` points to the filing being amended.
- `address.state` is a US state code, or an EDGAR country code (for example `A1`) for foreign issuers. `stateName` spells it out.

## How much does SEC Form D data cost?

This actor is priced **per result** (pay-per-event):

| Event                                   | Price     |
| --------------------------------------- | --------- |
| Form D filing (one item in the dataset) | **$0.01** |

For example, 1,000 filings cost $10.00, and a daily delta-mode feed of new startup rounds (about 100 operating-company filings per business day) costs about $1 per day. Filings skipped by filters or delta mode are free. If you set a **maximum cost per run**, the actor stops cleanly when it reaches that limit.

## Tips for tracking startup funding with Form D

- **Daily "recently funded" leads:** schedule the actor daily with `lastNDays: 3`, `excludeInvestmentFunds: true` and `onlyNew: true`, then send results to Google Sheets, a CRM, email or Slack through Apify integrations.
- **Real raises only:** add `minOfferingAmount` (for example `1000000`) to drop tiny offerings and syndications.
- **Fund launches:** set `industryGroups` to `["Pooled Investment Fund"]` and read `investmentFundType` for hedge, private equity and VC funds.
- **Backfills:** use `startDate`/`endDate` for any period since 2009, when Form D moved to XML.
- To identify your own organization to the SEC, set a `SEC_USER_AGENT` environment variable, such as `"Your Company admin@yourcompany.com"`.

## SEC Form D scraper FAQ

**Is this data official?** Yes. Every record is parsed from the Form D filed on SEC EDGAR, and `filingUrl` links to the original filing.

**How fresh is it?** Filings appear on EDGAR within minutes of acceptance, and the actor searches through today. EDGAR accepts filings on business days only.

**Why is a well-known company's round missing?** Not every raise needs a Form D, some are filed late, and many startups raise through a series of SAFEs filed under one notice. Form D also doesn't reveal valuation or investor names.

**Can I use it through the API or with AI agents?** Yes. Call it through the Apify API, the MCP server or any Apify integration.

**Disclaimer:** This actor is not affiliated with the U.S. Securities and Exchange Commission. You are responsible for following marketing laws (CAN-SPAM, TCPA, GDPR) when you contact issuers or related persons.

## Related actors

- [new-business-registrations](https://apify.com/cprussin/new-business-registrations?fpr=to54nm): Newly registered LLCs and corporations from state registries.
- [ycombinator-companies](https://apify.com/cprussin/ycombinator-companies?fpr=to54nm): Y Combinator startups by batch, industry and region, plus YC startup jobs.
- [federal-recompete-radar](https://apify.com/cprussin/federal-recompete-radar?fpr=to54nm): US federal contracts nearing expiry, for recompete pipelines.
