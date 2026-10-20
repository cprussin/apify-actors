# Cutshort Jobs Scraper: India Tech Jobs, Salary & Skills

**Cutshort Jobs Scraper** exports tech and startup job listings from Cutshort (cutshort.io) as clean JSON, CSV or Excel. It reads the same public job pages the website shows to logged-out visitors, no login needed:

- ✅ **Jobs by skill or role and city**: `python`, `reactjs`, `java`, `devops`, `product-manager`, ... in Bangalore, Mumbai, Pune, Hyderabad, Delhi NCR, Chennai and more, remote, or all of India.
- ✅ **Salary and experience ranges**: yearly salary range (Cutshort shows salary on almost every job) and years of experience.
- ✅ **Job details**: title, company (size, stage, type, founded, website), skills, locations, work mode (onsite / remote / both), role type, posted date, job URL and description snippet. Full description optional.
- ✅ **Monitor mode**: get only **new**, **updated** and **removed** jobs since the last run.
- ✅ **All jobs**: leave skills empty to export every job in Cutshort's jobs sitemap.
- ✅ Fast, light and polite: plain HTTP, one request at a time, no browser. Pay only for jobs written to your dataset.

## Start in one minute

Click **Start** with the prefilled input:

```json
{
  "skills": ["python"],
  "cities": ["bangalore"],
  "maxItems": 20
}
```

You get: the 20 newest Python jobs in Bangalore, with `headline`, `companyName`, `salaryMin`/`salaryMax`, `experienceMin`/`experienceMax`, `skills`, `locations` and `url`.

**Cost:** $0.03: 20 jobs × $0.0015, plus the $0.00005 actor-start fee.

## Use with an AI assistant

Connect the [Apify MCP server](https://mcp.apify.com) to Claude, ChatGPT, Cursor or any MCP client (`https://mcp.apify.com?tools=cprussin/cutshort-jobs` loads only this actor), then paste:

```text
Use the Apify actor cprussin/cutshort-jobs to get the 30 newest React.js jobs in Pune on Cutshort, and summarize the salary range by experience level and the most requested skills.
```

## Recipes

### Backend jobs in two cities

Newest Golang and Node.js jobs in Bangalore and Hyderabad.

```json
{
  "skills": ["golang", "nodejs"],
  "cities": ["bangalore", "hyderabad"],
  "maxItems": 100
}
```

### Remote jobs with full descriptions

Remote DevOps jobs with the full description, valid-through date and tags.

```json
{
  "skills": ["devops"],
  "cities": ["remote"],
  "maxItems": 20,
  "includeDetails": true
}
```

### Daily new, updated and removed jobs

Schedule it daily: after the first (baseline) run you get, and pay for, only changes.

```json
{
  "skills": ["python", "datascience"],
  "cities": ["pune"],
  "maxItems": 1000,
  "monitorMode": true
}
```

### Older jobs: pages 3 to 4

Skip the newest 100 jobs and read the next two pages (50 jobs each).

```json
{
  "skills": ["java"],
  "startPage": 3,
  "maxPages": 2,
  "maxItems": 100
}
```

### Every job on Cutshort

Empty skills: all jobs in Cutshort's jobs sitemap, each with full details.

```json
{
  "skills": [],
  "maxItems": 500
}
```

## Who uses Cutshort job data?

- **Recruiters and staffing agencies**: see which startups hire for a skill in a city right now, with pay and experience.
- **Sales and lead generation**: companies hiring engineers are growing and buying. Company size, stage and website are included.
- **Job seekers and job boards**: build your own feed or alerts for Indian tech jobs with salary.
- **HR and market analysts**: benchmark salaries and in-demand skills by role, city and experience.
- **AI agents**: give an LLM live Indian tech job listings through the Apify API or MCP server.

## How does the Cutshort jobs scraper work?

1. Add skills or roles and (optionally) cities.
2. For each skill × city, the actor reads Cutshort's listing (e.g. [cutshort.io/jobs/python-jobs-in-pune](https://cutshort.io/jobs/python-jobs-in-pune)), 50 jobs per page, newest first, about one request per second.
3. It pages through results until `maxItems` jobs in total, `maxPages` pages, or the end of the listing.
4. With `includeDetails`, it also opens each job page (`cutshort.io/job/...`).
5. Without skills, it reads Cutshort's jobs sitemap and opens each job page.

## How do I choose which Cutshort jobs to scrape?

| Field                | Description                                                                | Example                     |
| -------------------- | -------------------------------------------------------------------------- | --------------------------- |
| `skills`             | Skills or roles, names or Cutshort slugs or listing URLs; empty = all jobs | `["python", "React.js"]`    |
| `cities`             | Cities (optional), or `remote`                                             | `["bangalore", "pune"]`     |
| `maxItems`           | Max jobs in total, across all searches                                     | `500`                       |
| `startPage`          | First listing page per search (50 jobs each)                               | `1`                         |
| `maxPages`           | Listing pages per search; 0 = all                                          | `2`                         |
| `includeDetails`     | Open each job page for the full description and more                       | `true`                      |
| `monitorMode`        | Only new, updated and removed jobs since the last run with the same search | `true`                      |
| `proxyConfiguration` | Optional Apify Proxy (not needed normally)                                 | `{ "useApifyProxy": true }` |

- **Skill names**: Cutshort has a listing per skill or role. Names are converted to its slugs (`React.js` → `reactjs`, `Data Science` → `datascience`). If a name is not found, the run log says so: open [cutshort.io/jobs](https://cutshort.io/jobs), find the listing and paste its URL or slug (e.g. `machine-learning-ml-jobs`).
- **Cities**: Bangalore, Mumbai, Pune, Hyderabad, Chennai, Delhi (Delhi, NCR, Gurgaon and Noida), Kolkata, Ahmedabad, Jaipur, Kochi, Indore, Chandigarh, Coimbatore and Bhubaneswar have listings, plus `remote`.

## What data do you get for each Cutshort job?

```json
{
  "jobId": "uhRqRgf1",
  "internalId": "6ad2060ef7ba8e021579552f",
  "headline": "GCP Data engineer",
  "companyName": "VY SYSTEMS PRIVATE LIMITED",
  "hiringForClient": false,
  "recruiterName": null,
  "companyLogoUrl": "https://cdnv2.cutshort.io/company-static/676cda781975060026864b32/user_uploaded_data/logos/company_logo.png",
  "companyUrl": "https://cutshort.io/company/vy-systems-private-limited-16-e43Khktp",
  "companyWebsite": "https://vysystems.com",
  "companyType": "Services",
  "companySize": "100-1000",
  "companyStage": "Profitable",
  "companyFounded": 2000,
  "locations": ["Bengaluru (Bangalore)", "Pune", "Hyderabad", "Chennai"],
  "workMode": "onsite",
  "remote": false,
  "experienceMin": 8,
  "experienceMax": 12,
  "salaryMin": 2000000,
  "salaryMax": 3000000,
  "salaryCurrency": "INR",
  "salaryText": "₹20L - ₹30L / yr",
  "skills": ["Python", "PySpark", "SQL", "Lead Generation"],
  "roleTypes": ["full_time"],
  "postedAt": "2026-10-16T11:10:06.864Z",
  "url": "https://cutshort.io/job/GCP-Data-engineer-Bengaluru-Bangalore-Pune-Hyderabad-Chennai-VY-SYSTEMS-PRIVATE-LIMITED-uhRqRgf1",
  "descriptionSnippet": "GCP Data engineer (L1 virtual, L2 or DM F2F ) GCP + Python + Pyspark + sql + Lead 8+yrs Bangalore/hyderabad location ( relocation profiles also from Chennai pune location) immediate to 15days",
  "searchSlug": "python-jobs-in-bangalore-bengaluru",
  "scrapedAt": "2026-10-16T13:00:00.000Z"
}
```

- `salaryMin`/`salaryMax` are **yearly** amounts (2000000 = ₹20 lakh a year), also for internships that Cutshort shows per month (`salaryText` keeps the shown form, e.g. `₹15000 - ₹18000 / mo`). `null` when not given.
- `workMode` is `onsite`, `remote` or `remoteOrOnsite`; `locations` is empty for remote-only jobs.
- Agency jobs have `hiringForClient: true`, the client in `companyName` and the agency in `recruiterName`.
- With `includeDetails` (and in all-jobs mode) each job also has `description` (plain text), `validThrough`, `employmentTypes`, `category`, `tags`, `postalCode` and `jobValid`.
- In monitor mode each job has `changeType`: `new`, `updated` or `removed`. Removed jobs carry only `jobId`, `headline`, `companyName` and `url`.

## How much does it cost to scrape Cutshort jobs?

Pay-per-event, only for jobs written to your dataset:

| Event       | Price       | When                                                                   |
| ----------- | ----------- | ---------------------------------------------------------------------- |
| Job         | **$0.0015** | Every job (or monitor-mode change) in the dataset                      |
| Job details | **$0.001**  | Only when the job page is fetched (`includeDetails`, or all-jobs mode) |

That's **$1.50 per 1,000 jobs**, or $2.50 per 1,000 with details. The default input (20 Python jobs in Bangalore) costs $0.03. In monitor mode unchanged jobs are free. If you set a **maximum cost per run**, the actor stops cleanly when it reaches it.

## How do I monitor Cutshort for new, updated and removed jobs?

Turn on `monitorMode` and run the actor on an [Apify schedule](https://docs.apify.com/platform/schedules) (e.g. daily; save the input as a task and schedule the task).

- The first run is a baseline and returns every job as `new`. Set `maxItems` high enough to cover all jobs of your searches.
- Later runs return only changes: `new` jobs, `updated` jobs (title, company, salary, experience, skills, locations, work mode or description changed) and `removed` jobs (no longer listed). Unchanged jobs are skipped and not billed. `maxItems` counts new and updated jobs; removed jobs don't count.
- Removed jobs are checked only when every search was read to the end (no `maxPages`, `startPage` 1, `maxItems` not reached). Otherwise the next complete run reports them.
- In all-jobs mode (no skills) you get new and removed jobs from the sitemap.
- State lives in your account in the key-value store `cutshort-jobs-state`, one record per set of searches. Changing the skills or cities starts a new baseline. It remembers the latest 50,000 jobs.

## Cutshort jobs scraper FAQ

**Is this an official Cutshort API?** No. It reads public job listings and job pages that cutshort.io shows to logged-out visitors, and respects its robots.txt (no `/view/j/`, `/vj/`, `?job_listing`, `?free_text` or `/apply/` pages).

**Why are some jobs outside my city?** Multi-city jobs are listed in each of their cities. Filter on `locations` if you need exact matches.

**Why do all-jobs runs include older jobs?** The sitemap lists every open job, including some posted long ago that are still marked open. Sort or filter on `postedAt`.

**Do I need a proxy?** No. cutshort.io answers Apify's servers directly. You can still enable Apify Proxy; the actor then switches IP automatically if a request is blocked.

**Can I use it through the API or with AI agents?** Yes. Call it through the Apify API, the Apify MCP server or any Apify integration.

**Disclaimer:** This actor is not affiliated with, endorsed by or sponsored by Cutshort. Cutshort is a trademark of its owner. You are responsible for complying with Cutshort's terms and applicable laws when using the data.

## Related actors

- [Instahyre Jobs Scraper](https://apify.com/cprussin/instahyre-jobs?fpr=to54nm): India tech jobs from Instahyre with employer size and founding year.
- [Hirist & iimjobs Jobs Scraper](https://apify.com/cprussin/hirist-iimjobs-jobs?fpr=to54nm): India tech jobs from Hirist and management jobs from iimjobs.
- [Foundit Jobs Scraper](https://apify.com/cprussin/foundit-jobs?fpr=to54nm): India jobs from Foundit (formerly Monster India) with salary, experience and skills.
- [Wellfound Jobs Scraper](https://apify.com/cprussin/wellfound-jobs?fpr=to54nm): Startup jobs from Wellfound (AngelList Talent) with salary, equity and company data.
