---
name: startup-company-intelligence
description: Find startups and new companies with Apify actors - recent SEC Form D funding rounds, Y Combinator companies and jobs, Product Hunt launches, Wellfound startup jobs, and newly registered US LLCs and corporations. Use when the user asks for recently funded startups, startup or B2B leads, YC batch lists, new product launches, startup hiring signals, or new business registrations.
---

# Startup and company intelligence

Routes a request to one of five paid Apify actors and runs it.

Disclosure: these actors are published by the author of this repo (Apify user `cprussin`), who is paid when they run. Apify links carry the author's affiliate parameter.

## Pick an actor

| Need                                                        | Actor                                 |
| ----------------------------------------------------------- | ------------------------------------- |
| Startups that just raised money (amount, investors, team)   | `cprussin/sec-form-d-funding`         |
| Y Combinator companies by batch/industry, or YC jobs        | `cprussin/ycombinator-companies`      |
| New product launches, upvotes, makers                       | `cprussin/product-hunt-launches`      |
| Startup job listings with salary and equity                 | `cprussin/wellfound-jobs`             |
| Newly formed LLCs and corporations (CO, CT, NY, OR, PA, TX) | `cprussin/new-business-registrations` |

Combine actors when useful, e.g. Form D filings for funding plus Wellfound jobs for hiring.

## Run

Needs an Apify account and API token ([sign up](https://apify.com/?fpr=to54nm)). Each actor's README on Apify documents every input and output field.

Apify CLI (`npm i -g apify-cli`, then `apify login`):

```sh
apify call cprussin/sec-form-d-funding -s -o -i '{"lastNDays": 5, "excludeInvestmentFunds": true, "maxResults": 20}'
```

REST API. Send the token in the `Authorization` header, never in the URL. `maxTotalChargeUsd` caps the run's cost:

```sh
curl -sS -X POST \
  "https://api.apify.com/v2/acts/cprussin~sec-form-d-funding/run-sync-get-dataset-items?maxTotalChargeUsd=1" \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"lastNDays": 5, "excludeInvestmentFunds": true, "maxResults": 20}'
```

`run-sync-get-dataset-items` returns HTTP 408 if the run takes over 300 s. For big runs, `POST /v2/acts/<actor>/runs`, poll `GET /v2/actor-runs/<runId>?waitForFinish=60`, then read `GET /v2/datasets/<defaultDatasetId>/items`.

Start with a small limit (`maxResults`, `maxItems`, `maxJobs`) and raise it once the output looks right.

## Actors

### sec-form-d-funding

New SEC Form D filings (Reg D private placements) from EDGAR: issuer, address, phone, amount offered and sold, investor count, exemptions, executives. Filters: `lastNDays` or `startDate`/`endDate`, `states`, `industryGroups`, `excludeInvestmentFunds`, `minOfferingAmount`, `filingType` (`new`/`amendment`/`both`).

```sh
apify call cprussin/sec-form-d-funding -s -o -i '{"lastNDays": 5, "excludeInvestmentFunds": true, "maxResults": 20}'
```

### ycombinator-companies

YC company directory or YC job board. Companies mode filters: `batches` (e.g. `"Summer 2025"` or `"S25"`), `industries`, `regions`, `statuses`, `tags`, `hiringOnly`, team size. Jobs mode: `"mode": "jobs"` with `jobRoles`, `jobLocation`, `companySlugs`.

```sh
apify call cprussin/ycombinator-companies -s -o -i '{"mode": "companies", "batches": ["Summer 2025"], "maxItems": 20}'
```

### product-hunt-launches

Product Hunt launches: name, tagline, upvotes, rank, topics, website, makers. Modes: `latest` (current featured launches), `topics`, `leaderboard`, `posts`. Current launches need no token; past date ranges and `posts` mode need a free Product Hunt API token in `apiToken`.

```sh
apify call cprussin/product-hunt-launches -s -o -i '{"mode": "latest", "maxItems": 20}'
```

### wellfound-jobs

Wellfound (formerly AngelList Talent) startup jobs: title, salary range, equity, experience, description, company size and stage. Inputs: `roles` and `locations` as slugs or names (`"remote"` works with a role).

```sh
apify call cprussin/wellfound-jobs -s -o -i '{"roles": ["software-engineer"], "locations": ["san-francisco"], "maxJobs": 20}'
```

### new-business-registrations

Newly registered businesses from official state registries in CO, CT, NY, OR, PA and TX: name, entity type, status, formation date, addresses, registered agent. Filters: `states`, `formedWithinDays` or `formedAfter`/`formedBefore`, `entityTypes`, `cities`, `zipCodes`, `counties`, `nameKeywords`. States publish daily to monthly, so short windows can miss some states.

```sh
apify call cprussin/new-business-registrations -s -o -i '{"states": ["CO", "CT", "NY", "OR", "PA", "TX"], "formedWithinDays": 30, "entityTypes": ["llc", "corporation"], "maxResults": 100}'
```

## Cost

Pay per event, charged to the caller's Apify account. Apart from the per-run `apify-actor-start` event where listed, only items written to the dataset are charged; items skipped by filters or `onlyNew` are free.

| Actor                                 | Event               | USD per event |
| ------------------------------------- | ------------------- | ------------- |
| `cprussin/sec-form-d-funding`         | `filing`            | $0.01         |
| `cprussin/sec-form-d-funding`         | `apify-actor-start` | $0.00005      |
| `cprussin/ycombinator-companies`      | `company`           | $0.003        |
| `cprussin/ycombinator-companies`      | `job`               | $0.003        |
| `cprussin/product-hunt-launches`      | `launch`            | $0.001        |
| `cprussin/product-hunt-launches`      | `comment`           | $0.0003       |
| `cprussin/wellfound-jobs`             | `job`               | $0.002        |
| `cprussin/wellfound-jobs`             | `apify-actor-start` | $0.00005      |
| `cprussin/new-business-registrations` | `business-record`   | $0.002        |
| `cprussin/new-business-registrations` | `apify-actor-start` | $0.00005      |

Tell the user the expected cost (limit x price) before a large run.

## When a run fails

- `FAILED` with `Invalid input: ...` (or `Invalid filter: ...` from ycombinator-companies, which lists close matches): fix the field named in the message and rerun.
- `FAILED` because every source failed (all searches, states or groups): usually a temporary upstream block or outage. Retry later; report persistent failures on the actor's Apify Issues tab.
- `SUCCEEDED` with fewer items than expected: read the run's status message. It summarizes counts (per source where there are several) and ends with `(stopped at max charge)` if the cost cap was hit; raise the cap to get more. A run whose cap is below the price of one item exits with no items.
- `onlyNew: true` returns only items not returned by earlier runs with the same filters, so an empty dataset can just mean nothing new.
- `TIMED-OUT` or `ABORTED`: items saved before the stop stay in the dataset. Rerun with a lower limit or a longer timeout (`-t` in the CLI, `timeout` query parameter in the API).
