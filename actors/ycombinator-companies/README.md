# Y Combinator Companies & Jobs Scraper: YC Startup Directory

**Y Combinator Companies Scraper** exports the [Y Combinator company directory](https://www.ycombinator.com/companies) and open jobs at YC startups as clean JSON, CSV or Excel. It reads the same public search index the ycombinator.com directory uses, so it's fast and complete, with no login and no browser:

- ✅ **All ~6,000 YC companies**, from Summer 2005 to the latest batch.
- ✅ **Filters**: batch (`Summer 2025` or `S25`), industry, region, status (Active, Acquired, Inactive, Public), tags, hiring, top companies, team size, free-text search.
- ✅ **Company data**: name, one-liner, long description, batch, status, stage, industries, regions, locations, tags, team size, website, YC page, launch date, hiring flag, top-company flag, logo.
- ✅ **Jobs mode**: open jobs at YC startups by role (and location, including remote), for specific companies, or for every hiring company that matches your filters.
- ✅ **Job data**: title, company, batch, location, remote, salary min/max with currency, equity range, minimum experience, job type, role, visa, apply link.
- ✅ **Monitoring**: `onlyNew` returns only companies or jobs not seen in earlier runs. Schedule it for new-batch or new-job alerts.
- ✅ Pay only for items written to your dataset.

## Who uses Y Combinator company data?

- **Sales and lead generation**: every new YC batch is a list of funded startups buying tools. Filter by batch, industry and team size.
- **Investors and analysts**: track batches, sectors, outcomes (acquired, public, inactive) and hiring activity.
- **Recruiters and job seekers**: find YC startups that are hiring, with salary and equity for each job.
- **Founders and researchers**: map competitors and market trends across YC batches.
- **AI agents**: give an LLM the YC directory through the Apify API or MCP server.

## How does the Y Combinator scraper work?

1. **Companies mode**: the actor loads ycombinator.com/companies once to get the public, search-only key of YC's company index, then queries that index with your filters. Results come in YC's directory order (or newest launches first).
2. **Jobs mode**: the actor reads YC's job board pages, e.g. `ycombinator.com/jobs/role/software-engineer` or `/jobs/role/designer/remote`, and company jobs pages like `ycombinator.com/companies/stripe/jobs`, and reads the job data embedded in them.
3. You get one dataset item per company or job, up to `maxItems`.

It respects ycombinator.com's robots.txt: it never requests the disallowed `/companies?...` filter URLs.

## How do I choose which YC companies or jobs to scrape?

| Field                       | Description                                                  | Example                                    |
| --------------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| `mode`                      | `companies` (directory) or `jobs`                            | `"companies"`                              |
| `query`                     | Free-text search over names and descriptions                 | `"payments"`                               |
| `batches`                   | YC batches, full names or short codes                        | `["Summer 2025", "W25"]`                   |
| `industries`                | Industries or sub-industries (any of)                        | `["Fintech", "Healthcare"]`                |
| `regions`                   | Regions or countries (any of)                                | `["Europe", "India"]`                      |
| `statuses`                  | `Active`, `Acquired`, `Inactive`, `Public`                   | `["Active"]`                               |
| `tags`                      | Company tags (any of)                                        | `["Developer Tools", "Open Source"]`       |
| `hiringOnly`                | Only companies with open jobs                                | `true`                                     |
| `topCompaniesOnly`          | Only YC Top Companies                                        | `true`                                     |
| `minTeamSize`/`maxTeamSize` | Team size range                                              | `10` / `200`                               |
| `sortBy`                    | `relevance` (YC's order) or `launchDate` (newest first)      | `"launchDate"`                             |
| `jobRoles`                  | Jobs mode: YC job board roles                                | `["software-engineer", "product-manager"]` |
| `jobLocation`               | Jobs mode: location for role pages                           | `"remote"`, `"san-francisco"`, `"london"`  |
| `companySlugs`              | Jobs mode: company slugs or YC URLs                          | `["stripe", "airbnb"]`                     |
| `jobsFromFilteredCompanies` | Jobs mode: jobs of every hiring company matching the filters | `true`                                     |
| `maxItems`                  | Max companies or jobs                                        | `500`                                      |
| `onlyNew`                   | Monitoring: only items not returned by an earlier run        | `true`                                     |

- Filter values are matched case-insensitively against YC's directory. A value that matches nothing stops the run with suggestions, so a typo never returns the wrong companies.
- Different filters combine with AND, values within one filter with OR.
- Job roles: `software-engineer`, `designer`, `product-manager`, `recruiting-hr`, `sales-manager`, `marketing`, `support`, `operations`, `science`, `finance`, `legal`.

Example: active fintech companies from the Summer and Winter 2025 batches.

```json
{
  "mode": "companies",
  "batches": ["S25", "W25"],
  "industries": ["Fintech"],
  "statuses": ["Active"],
  "maxItems": 500
}
```

Example: all open jobs at Summer 2025 startups.

```json
{
  "mode": "jobs",
  "batches": ["Summer 2025"],
  "jobsFromFilteredCompanies": true,
  "maxItems": 1000
}
```

## What data do you get for each YC company?

```json
{
  "companyId": "30832",
  "name": "F2",
  "slug": "f2",
  "formerNames": [],
  "oneLiner": "The AI platform for private markets investors",
  "longDescription": "F2 is the AI platform for private markets investors. Purpose-built for private credit, private equity, and commercial banking, ...",
  "batch": "Summer 2025",
  "batchCode": "S25",
  "status": "Active",
  "stage": "Early",
  "industry": "B2B",
  "subindustry": "Engineering, Product and Design",
  "industries": ["B2B", "Engineering, Product and Design"],
  "regions": [
    "United States of America",
    "America / Canada",
    "Remote",
    "Partly Remote"
  ],
  "locations": "New York City, NY, USA",
  "tags": ["AI"],
  "teamSize": 15,
  "website": "http://f2.ai",
  "ycUrl": "https://www.ycombinator.com/companies/f2",
  "jobsUrl": "https://www.ycombinator.com/companies/f2/jobs",
  "launchedAt": "2025-11-10T15:49:41.000Z",
  "isHiring": true,
  "topCompany": false,
  "nonprofit": false,
  "logoUrl": "https://bookface-images.s3.amazonaws.com/small_logos/976c3cad3814111f1af6d087f0a0fe249be74b42.png",
  "scrapedAt": "2026-10-03T00:00:00.000Z"
}
```

## What data do you get for each YC job?

```json
{
  "jobId": "94746",
  "title": "Applied AI Engineer",
  "jobUrl": "https://www.ycombinator.com/companies/infer/jobs/1DhbYdF-applied-ai-engineer",
  "applyUrl": "https://account.ycombinator.com/authenticate?continue=...",
  "companyName": "Infer",
  "companySlug": "infer",
  "companyUrl": "https://www.ycombinator.com/companies/infer",
  "companyBatch": "S21",
  "companyOneLiner": "Operating system for insurance agencies",
  "companyLogoUrl": "https://bookface-images.s3.amazonaws.com/small_logos/f093ce23ca35f332213eeee11dee08581cefba9d.png",
  "location": "Bengaluru, KA, IN / Bengaluru, Karnataka, IN",
  "locations": ["Bengaluru, KA, IN", "Bengaluru, Karnataka, IN"],
  "remote": false,
  "jobType": "Full-time",
  "role": "Engineering",
  "roleCategory": "eng",
  "roleSubtype": "Machine learning",
  "salaryRange": "₹2M - ₹5M INR",
  "salaryMin": 2000000,
  "salaryMax": 5000000,
  "salaryCurrency": "INR",
  "salaryPeriod": null,
  "equityRange": "0.01% - 0.20%",
  "equityMin": 0.01,
  "equityMax": 0.2,
  "experience": "3+ years",
  "minExperienceYears": 3,
  "visa": "US citizenship/visa not required",
  "skills": [],
  "postedAgo": "5 months",
  "lastActive": "8 days",
  "sourceUrl": "https://www.ycombinator.com/jobs/role/software-engineer",
  "scrapedAt": "2026-10-03T00:00:00.000Z"
}
```

- `salaryMin`/`salaryMax` are amounts in `salaryCurrency` as posted ("$200K" = 200000, "₹2M" = 2000000), usually yearly. `salaryPeriod` is set when YC states another period (e.g. `monthly`).
- `equityMin`/`equityMax` are percentages (`0.5` = 0.5%). `minExperienceYears` is `0` for "Any (new grads ok)".
- `postedAgo` is YC's relative age ("5 months"); YC doesn't publish exact posting dates.

## How much does it cost to scrape Y Combinator companies?

Pay-per-event, only for items written to your dataset:

| Event   | Price      |
| ------- | ---------- |
| Company | **$0.003** |
| Job     | **$0.003** |

That's **$3 per 1,000 companies or jobs**. The default input (20 Summer 2025 companies) costs $0.06. A whole batch of ~170 companies costs about $0.50, and the full directory of ~6,000 companies about $19. If you set a **maximum cost per run**, the actor stops cleanly when it reaches it.

## How do I monitor YC for new companies or jobs?

Turn on `onlyNew` and run the actor on an [Apify schedule](https://docs.apify.com/platform/schedules) (e.g. daily; save the input as a task and schedule the task).

- The first run is a baseline and returns items as usual. Later runs return, and charge for, only companies (by `companyId`) or jobs (by `jobId`) not returned before. Skipped items are never charged.
- New-batch alerts: `batches: ["Fall 2026"]` with `onlyNew` returns each company once as YC adds it to the directory. New jobs: a role or company list in Jobs mode.
- State lives in your account in the key-value store `ycombinator-companies-state`, one record per mode and set of filters. Changing them starts a new baseline. It remembers the latest 50,000 items.
- Add a Slack, email or webhook integration to the task to get alerts.

## Y Combinator scraper FAQ

**Is this an official YC API?** No. It uses the public, search-only key that ycombinator.com's own directory page uses, and YC's public job board pages.

**How many companies can I get?** All of them. YC's search index returns at most 1,000 results per query, so for bigger result sets the actor continues batch by batch automatically.

**Why does a jobs page fail with "no jobs page for location"?** YC shows all locations for location slugs it doesn't know. The actor detects this instead of returning unrelated jobs. Try `remote`, `san-francisco`, `new-york`, `los-angeles`, `seattle`, `boston`, `austin`, `london` or `india`.

**Do I need a proxy?** No. You can add Apify Proxy for ycombinator.com pages, but it's rarely needed.

**Can I use it through the API or with AI agents?** Yes. Call it through the Apify API, the Apify MCP server or any Apify integration.

**Disclaimer:** This actor is not affiliated with, endorsed by or sponsored by Y Combinator. Y Combinator is a trademark of its owner. You are responsible for complying with ycombinator.com's terms and applicable laws when using the data.

## Related actors

- [product-hunt-launches](https://apify.com/cprussin/product-hunt-launches?fpr=to54nm): Product Hunt launches, leaderboards, upvotes and makers.
- [wellfound-jobs](https://apify.com/cprussin/wellfound-jobs?fpr=to54nm): Startup jobs from Wellfound (AngelList Talent) with salary, equity and company data.
- [new-business-registrations](https://apify.com/cprussin/new-business-registrations?fpr=to54nm): New LLC and corporation filings from state open-data portals.
