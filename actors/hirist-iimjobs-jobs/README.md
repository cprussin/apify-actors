# Hirist & iimjobs Jobs Scraper: India Tech & Management Jobs

**Hirist & iimjobs Jobs Scraper** exports job listings from **Hirist** (hirist.tech, India's tech job board) and **iimjobs** (iimjobs.com, management, finance, sales and marketing jobs) as clean JSON, CSV or Excel. It reads the same public search data both websites load, no login needed:

- ✅ **Two job boards, one actor**: search Hirist, iimjobs or both with the same queries.
- ✅ **Filters**: keywords (`python developer`, `product manager`, `investment banking`, ...), cities (`Bangalore`, `Mumbai`, `Delhi NCR`, `Remote`, ...) and years of experience.
- ✅ **Experience and salary**: experience range in years, yearly salary range in INR when the recruiter discloses it.
- ✅ **Job details**: title, designation, company, logo, locations, skills, posted date, applicant count, recruiter, job URL; full description optional.
- ✅ **Monitoring mode**: get only jobs you haven't seen before, for daily new-job alerts.
- ✅ Polite and light: plain JSON requests, one at a time, no browser, and iimjobs' requested 10-second crawl delay respected. Pay only for jobs written to your dataset.

## Who uses Hirist and iimjobs job data?

- **Recruiters and staffing agencies**: see which companies are hiring engineers or managers in a city right now, with experience and pay.
- **Sales and lead generation**: companies hiring many engineers, product managers or sales leaders are growing and buying; reach them first.
- **Job seekers and job boards**: build your own feed or alerts for Indian tech and MBA jobs.
- **HR and market analysts**: benchmark in-demand skills, experience levels and salaries by role and city.
- **AI agents**: give an LLM live Indian job listings through the Apify API or MCP server.

## How does the Hirist and iimjobs scraper work?

1. Pick the site(s), add search queries and (optionally) locations and an experience range.
2. The actor calls the sites' public search API for each query, 50 jobs per page: about one request per second on Hirist, one per 10 seconds on iimjobs (its robots.txt asks for that).
3. It pages through results until `maxItems` jobs in total, or the end of the results.
4. You get one dataset item per job, in the sites' own ranking.

## How do I choose which jobs to scrape?

| Field                | Description                                                                 | Example                              |
| -------------------- | --------------------------------------------------------------------------- | ------------------------------------ |
| `site`               | `hirist` (tech), `iimjobs` (management) or `both`                           | `"both"`                             |
| `queries`            | Search keywords. Each query is searched on every selected site              | `["data scientist", "growth"]`       |
| `locations`          | City or state filters (optional); jobs in any of them match                 | `["Bangalore", "Gurgaon", "Remote"]` |
| `minExperience`      | Only jobs whose experience range reaches at least this many years           | `3`                                  |
| `maxExperience`      | Only jobs whose experience range starts at or below this many years         | `8`                                  |
| `maxItems`           | Max jobs in total, split evenly between the sites                           | `500`                                |
| `includeDescription` | Add the full job description (one extra request per job)                    | `true`                               |
| `onlyNew`            | Monitoring: only jobs not returned by an earlier run with the same searches | `true`                               |
| `proxyConfiguration` | Optional Apify Proxy (not needed normally)                                  | `{ "useApifyProxy": true }`          |

- Locations accept common spellings: `Bangalore`/`Bengaluru`, `Gurgaon`/`Gurugram`, `Delhi NCR`, `Navi Mumbai`, `Kochi`, `Remote`, `Anywhere in India`, states such as `Karnataka`, and abroad (`Singapore`, `Dubai`, `US`, ...).
- With `site: "both"`, `maxItems` is split evenly; if Hirist runs out of jobs, iimjobs gets the rest.

Example: product and growth roles for 3–8 years of experience in Bangalore or Gurgaon, up to 200, on both sites.

```json
{
  "site": "both",
  "queries": ["product manager", "growth marketing"],
  "locations": ["Bangalore", "Gurgaon"],
  "minExperience": 3,
  "maxExperience": 8,
  "maxItems": 200
}
```

## What data do you get for each job?

```json
{
  "jobId": "1675588",
  "site": "hirist",
  "title": "Zeta - Product Manager - Fintech Domain",
  "designation": "Product Manager",
  "company": "Zeta Tech",
  "companyLogoUrl": "https://rec-assets.iimjobs.com/CompanyLogos/centralised-218.webp",
  "locations": ["Bangalore"],
  "remote": false,
  "experienceMin": 4,
  "experienceMax": 9,
  "salaryMin": null,
  "salaryMax": null,
  "salaryCurrency": null,
  "skills": [
    "Product Management",
    "Agile",
    "Product Roadmap",
    "Product Strategy",
    "Jira"
  ],
  "postedAt": "2026-09-29T10:19:12.990Z",
  "applicants": 364,
  "recruiterName": "Janushi",
  "jobUrl": "https://www.hirist.tech/j/zeta-product-manager-fintech-domain-1675588",
  "applyUrl": null,
  "descriptionSnippet": null,
  "searchQuery": "product manager",
  "scrapedAt": "2026-10-04T13:15:30.922Z"
}
```

- `salaryMin`/`salaryMax` are yearly amounts in INR (2000000 = ₹20 lakh a year). Most recruiters hide the salary; then all three salary fields are `null`.
- `experienceMin`/`experienceMax` are years.
- `company` and `recruiterName` are `null` for confidential jobs.
- `jobId` is unique per site; use `site` + `jobId` as the key when combining both.
- `description` and `descriptionSnippet` are filled only with `includeDescription: true`.
- `applyUrl` is set when the job is applied for on an external site; otherwise apply on `jobUrl`.

## How much does it cost to scrape Hirist and iimjobs jobs?

Pay-per-event, only for jobs written to your dataset:

| Event | Price      |
| ----- | ---------- |
| Job   | **$0.002** |

That's **$2 per 1,000 jobs**. The default input (20 product manager jobs in Bangalore, 10 per site) costs $0.04. If you set a **maximum cost per run**, the actor stops cleanly when it reaches it.

## How fast is it?

- **Hirist**: about 50 jobs per second (50 jobs per page, one page per second).
- **iimjobs**: 50 jobs every 10 seconds, because iimjobs.com asks crawlers to wait 10 seconds between requests.
- **Descriptions** need one request per job: ~1 s per job on Hirist and 10 s per job on iimjobs. Leave `includeDescription` off for large runs.

## How do I monitor Hirist and iimjobs for new jobs?

Turn on `onlyNew` and run the actor on an [Apify schedule](https://docs.apify.com/platform/schedules) (e.g. daily; save the input as a task and schedule the task).

- The first run is a baseline and returns jobs as usual. Later runs return, and charge for, only jobs not returned before. Skipped jobs are never charged.
- `maxItems` counts only new jobs.
- State lives in your account in the key-value store `hirist-iimjobs-jobs-state`, one record per set of searches (sites, queries, locations, experience). Changing them starts a new baseline. It remembers the latest 50,000 jobs.
- Add a Slack, email or webhook integration to the task to get new-job alerts.

## Hirist and iimjobs scraper FAQ

**Is this an official Hirist or iimjobs API?** No. It reads the public search results the sites show to logged-out visitors, and respects their robots.txt, including iimjobs' crawl delay.

**Why are some jobs outside my city?** Multi-city jobs match any of their cities, and "Anywhere in India" jobs can match too. Filter on `locations` in the output if you need exact matches.

**What's the difference between the sites?** Hirist lists software, data and IT jobs; iimjobs lists management, finance, consulting, sales, marketing and HR jobs. Both run on the same platform, with separate job IDs.

**Do I need a proxy?** No. The APIs answer Apify's servers directly. You can still enable Apify Proxy; the actor then switches IP automatically if a request is blocked.

**Can I use it through the API or with AI agents?** Yes. Call it through the Apify API, the Apify MCP server or any Apify integration.

**Disclaimer:** This actor is not affiliated with, endorsed by or sponsored by Hirist or iimjobs. Hirist and iimjobs are trademarks of their owners. You are responsible for complying with the sites' terms and applicable laws when using the data.

## Related actors

- [foundit-jobs](https://apify.com/cprussin/foundit-jobs): Indian job listings from Foundit (Monster India) with salary, experience and skills.
- [wellfound-jobs](https://apify.com/cprussin/wellfound-jobs): Startup jobs from Wellfound (AngelList Talent) with salary, equity and company data.
- [ycombinator-companies](https://apify.com/cprussin/ycombinator-companies): Y Combinator company directory by batch, industry and region, plus YC startup jobs.
- [new-business-registrations](https://apify.com/cprussin/new-business-registrations): New LLC and corporation filings from state open-data portals.
