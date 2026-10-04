# Wellfound Jobs Scraper: Startup Jobs, Salary & Equity

**Wellfound Jobs Scraper** exports startup job listings from Wellfound (formerly AngelList Talent) as clean JSON, CSV or Excel. Wellfound has no public jobs API, so this actor reads the same public listing pages the wellfound.com website shows, no login needed:

- ✅ **Jobs by role and location**: any role (`software-engineer`, `product-manager`, `data-analyst`, ...) in any city, or **remote**.
- ✅ **Salary and equity**: parsed min/max salary with currency (USD, CAD, EUR, GBP, INR, ...), and equity range in percent, plus the raw text.
- ✅ **Job details**: title, role, job type, posted date, locations, remote flag and accepted remote regions, years of experience, full description.
- ✅ **Company data**: name, Wellfound page, logo, company size, funding stage, one-liner and badges (YC, Top Investors, Growing Fast, ...).
- ✅ **Start URLs**: paste any Wellfound role or location listing page.
- ✅ Deduplicated across searches, so a job that matches two searches is returned (and billed) once.
- ✅ Handles rate limits: new proxy IP on every blocked or failed request, direct fallback when the proxy is down.
- ✅ Fast and light: plain HTTP requests, no browser. Pay only for jobs written to your dataset.

## Who uses Wellfound job data?

- **Recruiters and staffing agencies**: find startups that are hiring for a role right now, with company size and stage.
- **Sales and lead generation**: startups hiring engineers, designers or sales reps are buying tools; reach them while they grow.
- **Job seekers and job boards**: aggregate startup jobs with salary and equity into your own feed or alerts.
- **Investors and analysts**: track hiring activity and pay ranges by role, city and funding stage.
- **AI agents**: give an LLM live startup job listings through the Apify API or MCP server.

## How does the Wellfound jobs scraper work?

1. Add roles and locations (or Wellfound listing URLs).
2. The actor loads each listing page, e.g. `wellfound.com/role/l/software-engineer/san-francisco`, and reads the job data embedded in it (the same data the page renders).
3. It follows `?page=2`, `?page=3`, ... up to `maxPages` per search, or until `maxJobs` jobs in total.
4. You get one dataset item per job, in Wellfound's order (grouped by company).

## How do I choose which Wellfound jobs to scrape?

| Field                | Description                                                                 | Example                                         |
| -------------------- | --------------------------------------------------------------------------- | ----------------------------------------------- |
| `roles`              | Role slugs or names. Each role is searched in every location                | `["software-engineer", "Product Manager"]`      |
| `locations`          | Location slugs or names, or `remote`                                        | `["san-francisco", "new-york", "remote"]`       |
| `startUrls`          | Wellfound listing pages (optional)                                          | `["https://wellfound.com/role/r/data-analyst"]` |
| `maxJobs`            | Max jobs in total, across all searches                                      | `500`                                           |
| `maxPages`           | Max listing pages per search (20 companies, usually 30–50 jobs per page)    | `10`                                            |
| `includeDescription` | Add the full job description (Markdown)                                     | `false`                                         |
| `onlyNew`            | Monitoring: only jobs not returned by an earlier run with the same searches | `true`                                          |
| `proxyConfiguration` | Apify Proxy (on by default; datacenter is enough)                           | `{ "useApifyProxy": true }`                     |

- **Roles only**: all locations (`/role/software-engineer`). **Locations only**: all roles (`/location/new-york`). Remote needs a role.
- Slugs are what you see in Wellfound URLs. Plain names work too: `"Data Analyst"` becomes `data-analyst`, `"New York"` becomes `new-york`.
- Supported start URLs: `/role/l/{role}/{location}`, `/role/r/{role}` (remote), `/role/{role}` and `/location/{location}`. `?page=N` sets the first page.

Example: remote and New York product manager jobs, up to 200.

```json
{
  "roles": ["product-manager"],
  "locations": ["remote", "new-york"],
  "maxJobs": 200,
  "maxPages": 5
}
```

## What data do you get for each Wellfound job?

```json
{
  "jobId": "4639821",
  "title": "Software Engineer",
  "role": "Software Engineer",
  "jobUrl": "https://wellfound.com/jobs/4639821-software-engineer",
  "jobType": "full-time",
  "postedAt": "2026-08-27T20:06:24.000Z",
  "locations": ["Denver", "San Francisco"],
  "remote": false,
  "workplace": "onsite",
  "remoteLocations": [],
  "compensation": "$150k – $176k",
  "salaryMin": 150000,
  "salaryMax": 176000,
  "salaryCurrency": "USD",
  "equityMin": null,
  "equityMax": null,
  "hasEquity": null,
  "yearsExperienceMin": null,
  "yearsExperienceMax": null,
  "description": "As a Software Engineer at Checkr, you will work on high-impact engineering projects ...",
  "companyId": "395014",
  "companyName": "Checkr",
  "companySlug": "checkr",
  "companyUrl": "https://wellfound.com/company/checkr",
  "companyLogoUrl": "https://photos.wellfound.com/startups/i/395014-2a2164ef6a8cd5954eb970228e62ce15-medium_jpg.jpg?buster=1692326450",
  "companySize": "501-1000",
  "companyStage": "Scale Stage",
  "companyOneLiner": "The only background check company using artificial intelligence and machine learning",
  "companyBadges": [
    "Actively Hiring",
    "B2B",
    "Top Investors",
    "YC Funded",
    "Valuation $1B+"
  ],
  "searchRole": "software-engineer",
  "searchLocation": "san-francisco",
  "searchUrl": "https://wellfound.com/role/l/software-engineer/san-francisco",
  "scrapedAt": "2026-10-01T00:00:00.000Z"
}
```

- `salaryMin`/`salaryMax` are yearly amounts in `salaryCurrency` as posted ("$150k" = 150000, "₹5L" = 500000). "Up to $150k" gives only `salaryMax`. `null` when the job shows no salary.
- `equityMin`/`equityMax` are percentages (`0.5` = 0.5%). `hasEquity` is `false` for "No equity" and `null` when not stated.
- `workplace` is `onsite`, `remote` or `onsiteOrRemote`. `remoteLocations` lists the regions a remote job accepts.
- `companyStage` is Wellfound's stage badge (Early, Growth, Scale or Public Stage); `null` when Wellfound shows none.

## How much does it cost to scrape Wellfound jobs?

Pay-per-event, only for jobs written to your dataset:

| Event | Price      |
| ----- | ---------- |
| Job   | **$0.002** |

That's **$2 per 1,000 jobs**. The default input (20 software engineer jobs in San Francisco) costs $0.04. All ~775 software engineer jobs in San Francisco cost about $1.55. If you set a **maximum cost per run**, the actor stops cleanly when it reaches it.

## Tips for scraping Wellfound startup jobs

- **Daily new jobs:** schedule the actor and filter on `postedAt`, or dedupe on `jobId` downstream. Send new jobs to Google Sheets, Slack or a webhook with Apify integrations.
- **Hiring leads:** run a role across several cities with `includeDescription: false`, then group by `companySlug` to get a list of hiring startups with size and stage.
- **Salary benchmarks:** filter `salaryCurrency` and aggregate `salaryMin`/`salaryMax` by role, city or `companyStage`.
- **Find the right slug:** open the role or city on wellfound.com and copy it from the URL, or paste the URL into `startUrls`.

## How do I monitor Wellfound for new items?

Turn on `onlyNew` and run the actor on an [Apify schedule](https://docs.apify.com/platform/schedules) (e.g. daily; save the input as a task and schedule the task).

- The first run is a baseline and returns jobs as usual. Later runs return, and charge for, only jobs (by `jobId`) not returned before. Skipped jobs are never charged.
- `maxJobs` counts only new jobs; `maxPages` still limits how deep each search goes.
- State lives in your account in the key-value store `wellfound-jobs-state`, one record per set of searches (roles × locations and start URLs). Changing them starts a new baseline. It remembers the latest 50,000 jobs.
- Add a Slack, email or webhook integration to the task to get new-job alerts.

## Wellfound jobs scraper FAQ

**Is this an official Wellfound API?** No. It reads the public job listing pages wellfound.com shows to logged-out visitors.

**Why are some jobs outside my role or city?** Wellfound's listing pages group jobs by company and include related roles and multi-location jobs. Filter on `role` or `locations` if you need exact matches.

**Why does a search fail with "no listing page"?** Wellfound redirects unknown role or location slugs to another page. The actor detects this instead of returning unrelated jobs. Check the slug on wellfound.com.

**Do I need a proxy?** Usually not, but Apify Proxy (datacenter) is enabled by default and the actor switches IP automatically when a request is blocked.

**Can I use it through the API or with AI agents?** Yes. Call it through the Apify API, the Apify MCP server or any Apify integration.

**Disclaimer:** This actor is not affiliated with, endorsed by or sponsored by Wellfound. Wellfound is a trademark of its owner. You are responsible for complying with Wellfound's terms and applicable laws when using the data.

## Related actors

- [foundit-jobs](https://apify.com/cprussin/foundit-jobs?fpr=to54nm): Indian job listings from Foundit (Monster India) with salary, experience and skills.
- [hirist-iimjobs-jobs](https://apify.com/cprussin/hirist-iimjobs-jobs?fpr=to54nm): India tech jobs from Hirist and management jobs from iimjobs, with experience, salary and skills.
- [product-hunt-launches](https://apify.com/cprussin/product-hunt-launches?fpr=to54nm): Product Hunt launches, leaderboards, upvotes and makers.
- [new-business-registrations](https://apify.com/cprussin/new-business-registrations?fpr=to54nm): New LLC and corporation filings from state open-data portals.
- [trustpilot-reviews](https://apify.com/cprussin/trustpilot-reviews?fpr=to54nm): Trustpilot reviews, ratings and TrustScore for any company.
- [ycombinator-companies](https://apify.com/cprussin/ycombinator-companies?fpr=to54nm): Y Combinator company directory by batch, industry and region, plus YC startup jobs.
