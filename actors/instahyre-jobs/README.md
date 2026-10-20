# Instahyre Jobs Scraper: India Tech Jobs & Employers

**Instahyre Jobs Scraper** exports job listings from Instahyre (instahyre.com), India's tech hiring platform, as clean JSON, CSV or Excel. It reads the same public job search data the Instahyre website loads, no login needed:

- ✅ **Jobs by skill, city and experience**: any skills (`Python`, `Java`, `React`, `AWS`, ...), cities (`Bangalore`, `Pune`, `Hyderabad`, `Gurgaon`, `Work From Home`, ...) and years of experience.
- ✅ **Job function, company size and job type**: e.g. `Backend Development` or `Data Science / Machine Learning`, small, medium or large employers, full-time jobs or internships.
- ✅ **Employer data on every job**: company name, tagline, founded year, headcount and logo.
- ✅ **Monitor mode**: flags each job as `new`, `updated` or `removed` since the previous run. Unchanged jobs are skipped and not billed.
- ✅ Fast, light and polite: plain JSON requests, one at a time, no browser. Pay only for jobs written to your dataset.

## Start in one minute

Click **Start** with the prefilled input:

```json
{
  "skills": ["Python"],
  "maxItems": 20
}
```

You get 20 Python jobs with `title`, `keywords`, `locations`, `jobUrl`, `employerName`, `employerHeadcount` and `employerFoundedYear`.

**Cost:** $0.03: 20 jobs × $0.0015, plus the $0.00005 actor-start fee.

## Use with an AI assistant

Connect the [Apify MCP server](https://mcp.apify.com) to Claude, ChatGPT, Cursor or any MCP client (`https://mcp.apify.com?tools=cprussin/instahyre-jobs` loads only this actor), then paste:

```text
Use the Apify actor cprussin/instahyre-jobs to get 50 backend Go jobs in Bangalore on Instahyre, and list which companies are hiring and how big they are.
```

## Recipes

### Backend jobs for mid-level engineers in two cities

```json
{
  "skills": ["Java", "Go"],
  "locations": ["Bangalore", "Pune"],
  "years": 4,
  "jobFunctions": ["Backend Development"],
  "maxItems": 100
}
```

### Startups hiring data scientists

Small companies only; sort by `employerFoundedYear` to find the youngest.

```json
{
  "jobFunctions": ["Data Science / Machine Learning"],
  "companySize": "small",
  "maxItems": 200
}
```

### Tech internships

```json
{
  "jobType": "internship",
  "maxItems": 100
}
```

### Daily hiring-change alert

Schedule it daily: after the first run you get (and pay for) only new, updated and removed jobs.

```json
{
  "skills": ["React"],
  "locations": ["Work From Home"],
  "maxItems": 500,
  "monitorMode": true
}
```

## Who uses Instahyre job data?

- **Recruiters and staffing agencies**: see which companies are hiring for a skill in a city right now.
- **Sales and lead generation**: employers opening many tech roles are growing and buying. Get their size and founded year with each job.
- **Job seekers and job boards**: build your own feed or alerts for Indian tech jobs.
- **Market analysts**: track in-demand skills, functions and hiring by company size over time.
- **AI agents**: give an LLM live Indian tech job listings through the Apify API or MCP server.

## How does the Instahyre jobs scraper work?

1. Set skills and any other filters.
2. The actor calls Instahyre's public job search API, 35 jobs per page, about one request per second.
3. It pages through results until `maxItems` jobs, or the end of the results.
4. You get one dataset item per job, in Instahyre's ranking order.

## Input

| Field                | Description                                                         | Example                     |
| -------------------- | ------------------------------------------------------------------- | --------------------------- |
| `skills`             | Skills; a job matches any of them. Empty = all jobs                 | `["Python", "Django"]`      |
| `locations`          | Cities; a job matches any of them. Empty = all of India             | `["Bangalore", "Pune"]`     |
| `years`              | Years of experience the job is open to (`0` = freshers)             | `3`                         |
| `jobFunctions`       | Instahyre job functions, by name                                    | `["DevOps / Cloud"]`        |
| `companySize`        | `any`, `small`, `medium` or `large`                                 | `"large"`                   |
| `jobType`            | `any`, `full-time` or `internship`                                  | `"internship"`              |
| `maxItems`           | Max jobs to output (in monitor mode: new, updated and removed jobs) | `500`                       |
| `monitorMode`        | Flag jobs as new, updated or removed since the previous run         | `true`                      |
| `proxyConfiguration` | Optional Apify Proxy (not needed normally)                          | `{ "useApifyProxy": true }` |

- **Locations** accept common spellings: `Bengaluru` = `Bangalore`, `Gurugram` = `Gurgaon`, `Remote` = `Work From Home`. A multi-city job matches if any of its cities does.
- **Job functions** use Instahyre's names, e.g. `Backend Development`, `Frontend Development`, `Full-Stack Development`, `Mobile Development`, `Data Science / Machine Learning`, `Data Engineering / DWH / ETL`, `DevOps / Cloud`, `Software Testing / QA / SDET`, `Product Management`, `Engineering Management`, `UX / Visual Design`.
- Instahyre serves at most 10,000 results per search. Narrow the filters to go deeper.

## What data do you get for each Instahyre job?

```json
{
  "jobId": "439850",
  "title": "Python Engineer",
  "keywords": ["API", "FastAPI", "Python", "REST"],
  "locations": ["Bangalore"],
  "jobUrl": "https://www.instahyre.com/job-439850-python-engineer-at-nineleaps-2-bangalore/",
  "employerId": "5003",
  "employerName": "Nineleaps",
  "employerTagline": "We build high performance solutions",
  "employerFoundedYear": 2014,
  "employerHeadcount": 200,
  "employerLogoUrl": "https://media.instahyre.com/images/profile/base/employer/5003/dcac758458/nineleaps.webp",
  "changeType": null,
  "scrapedAt": "2026-10-16T13:20:28.220Z"
}
```

- `keywords` are the skills the employer tagged on the job.
- `employerHeadcount` is Instahyre's size bucket (the lower bound: `200` means 200+ employees).
- `changeType` is `new`, `updated` or `removed` in monitor mode, otherwise `null`.
- No job descriptions, salaries or recruiter contacts: Instahyre shows those only on its job pages and to signed-in candidates.

## How much does it cost to scrape Instahyre jobs?

Pay-per-event, only for jobs written to your dataset:

| Event | Price       |
| ----- | ----------- |
| Job   | **$0.0015** |

That's **$1.50 per 1,000 jobs**. In monitor mode, unchanged jobs are skipped and free. If you set a **maximum cost per run**, the actor stops cleanly when it reaches it.

## How do I monitor Instahyre for new and changed jobs?

Turn on `monitorMode` and run the actor on an [Apify schedule](https://docs.apify.com/platform/schedules) (e.g. daily; save the input as a task and schedule the task).

- The first run is a baseline: every job is `new`.
- Later runs output only jobs that are `new`, `updated` (title, skills, locations or employer changed) or `removed` (no longer in the results). Unchanged jobs are skipped and not charged.
- Removed jobs come with their latest data when Instahyre still has it.
- Removals are detected only when a run reads every result. Set `maxItems` above the number of changes you expect; a run that stops early checks removals on a later run.
- State lives in your account in the key-value store `instahyre-jobs-state`, one record per set of filters. Changing the filters starts a new baseline. It remembers 50,000 jobs.
- Add a Slack, email or webhook integration to the task to get alerts.

## Instahyre jobs scraper FAQ

**Is this an official Instahyre API?** No. It reads the public job search results instahyre.com shows to logged-out visitors, and respects instahyre.com's robots.txt.

**Why no job descriptions?** Instahyre's job pages are behind a bot challenge. This actor reads only the open search API, so it stays fast and cheap.

**Do I need a proxy?** No. The Instahyre API answers Apify's servers directly. You can still enable Apify Proxy; the actor then switches IP automatically if a request is blocked.

**Can I use it through the API or with AI agents?** Yes. Call it through the Apify API, the Apify MCP server or any Apify integration.

**Disclaimer:** This actor is not affiliated with, endorsed by or sponsored by Instahyre. Instahyre is a trademark of its owner. You are responsible for complying with Instahyre's terms and applicable laws when using the data.

## Related actors

- [Cutshort Jobs Scraper](https://apify.com/cprussin/cutshort-jobs?fpr=to54nm): India tech jobs from Cutshort with salary, experience and skills.
- [Hirist & iimjobs Jobs Scraper](https://apify.com/cprussin/hirist-iimjobs-jobs?fpr=to54nm): India tech jobs from Hirist and management jobs from iimjobs.
- [Foundit Jobs Scraper](https://apify.com/cprussin/foundit-jobs?fpr=to54nm): India jobs from Foundit (formerly Monster India) with salary, experience and skills.
- [Wellfound Jobs Scraper](https://apify.com/cprussin/wellfound-jobs?fpr=to54nm): Startup jobs from Wellfound (AngelList Talent) with salary, equity and company data.
