# New Business Registrations: multi-state feed of new LLCs and corporations

**New Business Registrations** returns businesses that were just formed, pulled from official state registries, so you can reach new owners before your competitors do. One run covers **Colorado, Connecticut, New York, Oregon, Pennsylvania and Texas**, and every state comes back in **one normalized schema**: name, entity type, status, formation date, principal and mailing address, registered agent, and a link to the source record.

- ✅ **6 states in one run.** Most new-business scrapers cover only Florida.
- ✅ **Delta mode** returns only businesses you haven't received yet, which suits daily or weekly scheduled runs.
- ✅ Official open-data APIs. No login, CAPTCHA or proxy needed.
- ✅ Filter by state, formation date, entity type, city, ZIP, county or keyword in the name.
- ✅ You pay per business returned. Empty runs cost next to nothing.

## Who uses new business registration data?

- **Insurance agents** (general liability, workers' comp, BOP) contact new LLCs before their first policy renewal.
- **Payroll, PEO and HR software** reach companies before they hire their first employee.
- **POS, merchant services and business banking** reach new retailers and restaurants before they open.
- **Accountants, bookkeepers and tax preparers** pick up new entities before their first filing deadline.
- **Web design, marketing, signage, uniforms and office suppliers** find brand-new local businesses.
- **Data teams and CRMs** receive a clean daily feed of formations for enrichment.

## How does the new business registrations scraper work?

1. Pick states, a formation-date window (default: the last 30 days) and any filters.
2. The actor queries each state's official Socrata open-data API, newest filings first. City, ZIP, county and keyword filters run on the server, so only matching rows are downloaded.
3. It normalizes every state into the same schema and interleaves states, so even a small `maxResults` covers all of them.
4. With `onlyNew`, businesses already delivered by earlier runs with the same settings are skipped (and not charged).

## Which states' new business filings are covered?

| State | Dataset                                                                   | Publisher                            | Updated | Notes                                                                             |
| ----- | ------------------------------------------------------------------------- | ------------------------------------ | ------- | --------------------------------------------------------------------------------- |
| CO    | [Business Entities in Colorado](https://data.colorado.gov/d/4ykn-tg5h)    | Colorado Secretary of State          | Daily   | Principal and mailing address, registered agent. No county.                       |
| CT    | [Business Registry - Business Master](https://data.ct.gov/d/n7gp-d28j)    | Connecticut Secretary of the State   | Daily   | Business address. No registered agent or county.                                  |
| NY    | [Active Corporations: Beginning 1800](https://data.ny.gov/d/n9v6-gdp6)    | New York Department of State         | Daily   | Service-of-process address (as mailing), registered agent, county. Active only.   |
| OR    | [Active Businesses - ALL](https://data.oregon.gov/d/tckn-sxa6)            | Oregon Secretary of State            | Weekly  | Principal and mailing address, registered agent. DBAs excluded. Active only.      |
| PA    | [Registered Business Entities](https://data.pa.gov/d/xvd7-5r2c)           | Pennsylvania Department of State     | Monthly | Address and county. No status or registered agent.                                |
| TX    | [Active Franchise Tax Permit Holders](https://data.texas.gov/d/9cir-efmm) | Texas Comptroller of Public Accounts | Weekly  | SOS file number and charter date, mailing address. Appears ~10 days after filing. |

Because states publish on different schedules, a 30-day window returns results from every state. For a daily run with `onlyNew`, each run picks up whatever each state has published since the last one.

## How do I filter new LLC and corporation filings?

| Field                          | Description                                                                      | Example                  |
| ------------------------------ | -------------------------------------------------------------------------------- | ------------------------ |
| `states`                       | States to search (empty = all)                                                   | `["CO", "NY", "TX"]`     |
| `formedWithinDays`             | Formation date within the last N days                                            | `30`                     |
| `formedAfter` / `formedBefore` | Exact date range (YYYY-MM-DD); overrides `formedWithinDays`                      | `"2026-09-01"`           |
| `entityTypes`                  | `llc`, `corporation`, `nonprofit`, `partnership`, `other` (empty = all)          | `["llc", "corporation"]` |
| `cities`                       | Exact city names (case-insensitive)                                              | `["Denver", "Brooklyn"]` |
| `zipCodes`                     | ZIP codes or 3-4 digit prefixes                                                  | `["802", "11201"]`       |
| `counties`                     | County names. Only NY and PA publish counties; other states are skipped when set | `["Kings", "Allegheny"]` |
| `nameKeywords`                 | Business name contains any of these                                              | `["roofing", "dental"]`  |
| `maxResults`                   | Maximum businesses to return across all states                                   | `100`                    |
| `onlyNew`                      | Delta mode: skip businesses returned by earlier runs with the same settings      | `true`                   |

Example input:

```json
{
  "states": ["CO", "NY", "TX"],
  "formedWithinDays": 14,
  "entityTypes": ["llc", "corporation"],
  "nameKeywords": ["construction", "roofing"],
  "maxResults": 500,
  "onlyNew": true
}
```

## What data do you get for each new business?

One dataset item per business:

```json
{
  "state": "CO",
  "entityId": "20261234567",
  "name": "Mile High Roofing LLC",
  "entityType": "DLLC",
  "entityCategory": "llc",
  "status": "Good Standing",
  "formationDate": "2026-09-25",
  "jurisdiction": "CO",
  "county": null,
  "principalAddress": {
    "street": "1600 Broadway",
    "street2": "Suite 200",
    "city": "Denver",
    "state": "CO",
    "zip": "80202",
    "country": "US"
  },
  "mailingAddress": {
    "street": "PO Box 123",
    "street2": null,
    "city": "Denver",
    "state": "CO",
    "zip": "80201",
    "country": "US"
  },
  "registeredAgentName": "Jane Q Doe",
  "registeredAgentAddress": {
    "street": "1600 Broadway",
    "street2": null,
    "city": "Denver",
    "state": "CO",
    "zip": "80202",
    "country": "US"
  },
  "sourceUrl": "https://data.colorado.gov/resource/4ykn-tg5h.json?%24where=entityid+%3D+%2720261234567%27",
  "sourceDataset": "data.colorado.gov/4ykn-tg5h (Business Entities in Colorado)"
}
```

(This is an illustrative record.)

**Field notes**

- `entityType` is the state's own label or code (for example `DLLC` in Colorado, `DOMESTIC LIMITED LIABILITY COMPANY` in New York). `entityCategory` maps it to a shared vocabulary for filtering.
- `jurisdiction` is the state or country of formation where the source provides it. Foreign entities are existing companies newly registered to do business in that state.
- Fields a state doesn't publish are `null` (see the Sources table). Addresses are `null` when every part is empty.
- The registered agent is often the owner for small LLCs, but it can also be a commercial agent service or a law firm.
- No state publishes phone numbers or emails in these datasets.

## How much does new business registration data cost?

This actor is priced **per result** (pay-per-event):

| Event                                     | Price      |
| ----------------------------------------- | ---------- |
| Business record (one item in the dataset) | **$0.002** |

For example, 1,000 new businesses cost $2.00. If you set a **maximum cost per run**, the actor stops cleanly when it reaches that limit.

## Tips for finding new business registrations

- **Daily lead feed:** schedule the actor daily with `onlyNew: true` and send results to Google Sheets, a CRM, email or Slack through Apify integrations.
- **Local focus:** combine `zipCodes` prefixes (for example `802` for Denver) with `entityTypes` to keep lists tight.
- Set a `SOCRATA_APP_TOKEN` environment variable (free from any Socrata portal) if you run very large pulls. It raises the API rate limit.
- A state that is temporarily down is logged and skipped. The rest of the run still completes.

## New business registrations FAQ

**Is this data official?** Yes. Every record comes from a state government open-data portal, and `sourceUrl` links to the exact source row.

**Why doesn't a business formed yesterday show up?** States publish with a lag: CO, CT and NY daily, OR and TX weekly, PA monthly.

**Which states are next?** Florida (Sunbiz), Iowa and others with bulk files. Adding a state is a small change, so ask in the Issues tab.

**Can I use it through the API or with AI agents?** Yes. Call it through the Apify API, the MCP server or any Apify integration.

**Disclaimer:** This actor is not affiliated with any state government. You are responsible for following marketing laws (CAN-SPAM, TCPA, state rules) when you contact businesses.

## Related actors

- [federal-recompete-radar](https://apify.com/cprussin/federal-recompete-radar): US federal contracts nearing expiry, for recompete pipelines.
- [trustpilot-reviews](https://apify.com/cprussin/trustpilot-reviews): Trustpilot reviews, ratings and TrustScore for any company.
- [eventbrite-events](https://apify.com/cprussin/eventbrite-events): Eventbrite events by city, category and date, with venues, organizers and prices.
