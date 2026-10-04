# Foundit Jobs Scraper: India Jobs, Salary & Skills

**Foundit Jobs Scraper** exports job listings from Foundit (foundit.in, formerly Monster India) as clean JSON, CSV or Excel. It reads the same public search data the foundit.in website loads, no login needed:

- ✅ **Jobs by keyword and city**: any query (`python developer`, `data analyst`, `sales manager`, ...) in any city (`Bangalore`, `Pune`, `Mumbai`, `Delhi`, ...), or everywhere.
- ✅ **Experience and salary**: years of experience range, yearly salary range with currency (INR, plus SGD, AED, ... for Gulf and Southeast Asia jobs) when the recruiter discloses it.
- ✅ **Job details**: title, company, locations, key skills, employment and job type, industries, functions, posted and updated dates, applicant count, job URL and description snippet (full description optional).
- ✅ **Newest first**: sort by date and turn on monitoring mode to get only jobs you haven't seen.
- ✅ Deduplicated across searches, so a job that matches two searches is returned (and billed) once.
- ✅ Fast, light and polite: plain JSON requests, one at a time, no browser. Pay only for jobs written to your dataset.

## Who uses Foundit job data?

- **Recruiters and staffing agencies**: see which companies are hiring for a skill in a city right now, with experience and pay.
- **Sales and lead generation**: companies hiring many engineers or sales staff are growing and buying; reach them first.
- **Job seekers and job boards**: build your own feed or alerts for Indian jobs with salary and skills.
- **HR and market analysts**: benchmark salaries and in-demand skills by role, city and experience level.
- **AI agents**: give an LLM live Indian job listings through the Apify API or MCP server.

## How does the Foundit jobs scraper work?

1. Add search queries and (optionally) locations.
2. The actor calls Foundit's public search API for each query × location, 20 jobs per page, about one request per second.
3. It pages through results until `maxItems` jobs in total, or the end of the results.
4. You get one dataset item per job, newest first (or in Foundit's relevance order).

## How do I choose which Foundit jobs to scrape?

| Field                | Description                                                                 | Example                     |
| -------------------- | --------------------------------------------------------------------------- | --------------------------- |
| `queries`            | Search keywords. Each query is searched in every location                   | `["java developer", "SAP"]` |
| `locations`          | City or country filters (optional), or `Remote`                             | `["Bangalore", "Pune"]`     |
| `sortBy`             | `date` (recently posted or refreshed first) or `relevance`                  | `"date"`                    |
| `maxItems`           | Max jobs in total, across all searches                                      | `500`                       |
| `includeDescription` | Add the full job description (plain text)                                   | `true`                      |
| `onlyNew`            | Monitoring: only jobs not returned by an earlier run with the same searches | `true`                      |
| `proxyConfiguration` | Optional Apify Proxy (not needed normally)                                  | `{ "useApifyProxy": true }` |

- **Queries only**: all locations (India, plus the Gulf and Southeast Asia jobs Foundit lists). **Locations only**: all jobs in the city.
- Locations work like the foundit.in location box: `Bangalore` and `Bengaluru` both match "Bengaluru / Bangalore". Use one city per entry.

Example: newest data analyst and data engineer jobs in Pune and Hyderabad, up to 200.

```json
{
  "queries": ["data analyst", "data engineer"],
  "locations": ["Pune", "Hyderabad"],
  "sortBy": "date",
  "maxItems": 200
}
```

## What data do you get for each Foundit job?

```json
{
  "jobId": "61745075",
  "title": "Machine Learning Engineer (AI/ML)",
  "companyName": "Rarr Technologies Private Limited",
  "companyId": "1248443",
  "companyLogoUrl": null,
  "locations": ["Bengaluru / Bangalore"],
  "country": "India",
  "remote": false,
  "experienceMin": 6,
  "experienceMax": 9,
  "salaryMin": 1300000,
  "salaryMax": 1500000,
  "salaryCurrency": "INR",
  "skills": [
    "Python",
    "Machine Learning",
    "Artificial Intelligence",
    "REST",
    "cloud",
    "Tensorflow",
    "gRPC services",
    "MLOps tools",
    "data pipelines"
  ],
  "employmentTypes": ["Full time"],
  "jobTypes": ["Permanent Job"],
  "industries": [],
  "functions": ["Others"],
  "postedAt": "2026-08-07T11:47:09.000Z",
  "updatedAt": "2026-10-02T20:54:50.000Z",
  "closesAt": "2026-12-01T18:30:00.000Z",
  "applicants": 368,
  "urgentlyHiring": false,
  "jobUrl": "https://www.foundit.in/job/machine-learning-engineer-ai-ml-rarr-technologies-private-limited-bengaluru-bangalore-61745075",
  "applyUrl": null,
  "descriptionSnippet": "Role Overview We are looking for an experienced Data Science & Machine Learning Engineer with strong expertise in AI/ML, Python, and Deep Learning to develop, deploy, and optimize machine learning solutions. Key Responsibilities - Develop and deploy ML/AI models using Python. - Work with ML ...",
  "searchQuery": "python developer",
  "searchLocation": "Bangalore",
  "scrapedAt": "2026-10-03T13:05:58.599Z"
}
```

- `salaryMin`/`salaryMax` are yearly amounts in `salaryCurrency` (1300000 = ₹13 lakh a year). `null` when the salary is hidden, confidential or not disclosed.
- `experienceMin`/`experienceMax` are years; 0–0 usually means freshers (or not stated).
- `companyName` is `null` when the recruiter lists the job as a confidential company.
- `applyUrl` is set when the job is applied for on an external site; otherwise apply on `jobUrl`.
- `description` (plain text) is added only with `includeDescription: true`.

## How much does it cost to scrape Foundit jobs?

Pay-per-event, only for jobs written to your dataset:

| Event | Price      |
| ----- | ---------- |
| Job   | **$0.002** |

That's **$2 per 1,000 jobs**. The default input (20 python developer jobs in Bangalore) costs $0.04. If you set a **maximum cost per run**, the actor stops cleanly when it reaches it.

## Tips for scraping Foundit jobs

- **Daily new jobs:** use `sortBy: "date"` with `onlyNew`, schedule it daily and send new jobs to Google Sheets, Slack or a webhook with Apify integrations.
- **Hiring leads:** run a skill across several cities, then group by `companyName` to see who is hiring the most.
- **Salary benchmarks:** filter on `salaryCurrency: "INR"` and aggregate `salaryMin`/`salaryMax` by query, city or experience.
- **Skills demand:** count `skills` across thousands of jobs for a role to see what employers ask for.

## How do I monitor Foundit for new jobs?

Turn on `onlyNew` and run the actor on an [Apify schedule](https://docs.apify.com/platform/schedules) (e.g. daily; save the input as a task and schedule the task).

- The first run is a baseline and returns jobs as usual. Later runs return, and charge for, only jobs (by `jobId`) not returned before. Skipped jobs are never charged.
- Keep `sortBy: "date"` so new jobs come first; `maxItems` counts only new jobs.
- State lives in your account in the key-value store `foundit-jobs-state`, one record per set of searches (queries × locations). Changing them starts a new baseline. It remembers the latest 50,000 jobs.
- Add a Slack, email or webhook integration to the task to get new-job alerts.

## Foundit jobs scraper FAQ

**Is this an official Foundit API?** No. It reads the public search results foundit.in shows to logged-out visitors, and respects foundit.in's robots.txt.

**Why are some jobs outside my city?** Foundit matches multi-city jobs and nearby or related locations. Filter on `locations` if you need exact matches.

**Why do I see Singapore or UAE jobs?** Foundit also lists Gulf and Southeast Asia jobs. Add a location such as `India` or a city to restrict results.

**Do I need a proxy?** No. The Foundit API answers Apify's servers directly. You can still enable Apify Proxy; the actor then switches IP automatically if a request is blocked.

**Can I use it through the API or with AI agents?** Yes. Call it through the Apify API, the Apify MCP server or any Apify integration.

**Disclaimer:** This actor is not affiliated with, endorsed by or sponsored by Foundit. Foundit is a trademark of its owner. You are responsible for complying with Foundit's terms and applicable laws when using the data.

## Related actors

- [hirist-iimjobs-jobs](https://apify.com/cprussin/hirist-iimjobs-jobs?fpr=to54nm): India tech jobs from Hirist and management jobs from iimjobs, with experience, salary and skills.
- [wellfound-jobs](https://apify.com/cprussin/wellfound-jobs?fpr=to54nm): Startup jobs from Wellfound (AngelList Talent) with salary, equity and company data.
- [new-business-registrations](https://apify.com/cprussin/new-business-registrations?fpr=to54nm): New LLC and corporation filings from state open-data portals.
- [trustpilot-reviews](https://apify.com/cprussin/trustpilot-reviews?fpr=to54nm): Trustpilot reviews, ratings and TrustScore for any company.
