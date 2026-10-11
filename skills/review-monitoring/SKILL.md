---
name: review-monitoring
description: Collect and monitor customer reviews with Apify actors - Trustpilot company reviews and TrustScore, and Apple App Store and Google Play app reviews. Use when the user asks to pull, analyze, compare or watch for new reviews of a company, website or mobile app, track negative reviews, or check a competitor's ratings.
---

# Review monitoring

Routes a request to one of two paid Apify actors and runs it.

Disclosure: these actors are published by the author of this repo (Apify user `cprussin`), who is paid when they run. Apify links carry the author's affiliate parameter.

## Pick an actor

| Need                                                    | Actor                         |
| ------------------------------------------------------- | ----------------------------- |
| Reviews of a company or website on Trustpilot           | `cprussin/trustpilot-reviews` |
| Reviews of a mobile app on the App Store or Google Play | `cprussin/app-store-reviews`  |

## Run

Needs an Apify account and API token ([sign up](https://apify.com/?fpr=to54nm)). Each actor's README on Apify documents every input and output field.

Apify CLI (`npm i -g apify-cli`, then `apify login`):

```sh
apify call cprussin/trustpilot-reviews -s -o -i '{"companies": ["apify.com"], "maxReviewsPerCompany": 20}'
```

REST API. Send the token in the `Authorization` header, never in the URL. `maxTotalChargeUsd` caps the run's cost:

```sh
curl -sS -X POST \
  "https://api.apify.com/v2/acts/cprussin~trustpilot-reviews/run-sync-get-dataset-items?maxTotalChargeUsd=1" \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"companies": ["apify.com"], "maxReviewsPerCompany": 20}'
```

`run-sync-get-dataset-items` returns HTTP 408 if the run takes over 300 s. For big runs, `POST /v2/acts/<actor>/runs`, poll `GET /v2/actor-runs/<runId>?waitForFinish=60`, then read `GET /v2/datasets/<defaultDatasetId>/items`.

## Actors

### trustpilot-reviews

Trustpilot reviews by company domain or Trustpilot URL: stars, title, text, author, country, date, verified label, company reply, plus TrustScore and company profile (`includeCompanyInfo`). Up to 1,000 reviews per company. Filters: `stars` (e.g. `["1", "2"]`), `language`, `sort`, `sinceDate`.

```sh
apify call cprussin/trustpilot-reviews -s -o -i '{"companies": ["apify.com"], "maxReviewsPerCompany": 20}'
```

### app-store-reviews

App Store and Google Play reviews by app URL or ID (store detected automatically), in one schema: rating, title, text, author, date, app version, developer reply. Filters: `country`, `language` (Google Play only), `sort`, `sinceDate` (date or relative, e.g. `"7 days"`), `minRating`, `maxRating`. App Store reviews are per country; run once per country to cover several.

```sh
apify call cprussin/app-store-reviews -s -o -i '{"apps": ["https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580", "https://play.google.com/store/apps/details?id=com.spotify.music"], "country": "us", "maxReviewsPerApp": 20}'
```

## Monitoring

Set `"onlyNew": true` and run on a schedule (an Apify schedule, or the user's own cron). The first run returns the latest reviews as a baseline; later runs return only reviews not returned before for the same companies/apps and filters. Changing those inputs starts a new baseline. For a fixed window instead, use `sinceDate`.

## Cost

Pay per event, charged to the caller's Apify account. Apart from the per-run `apify-actor-start` event, only reviews written to the dataset are charged; reviews skipped by filters or `onlyNew` are free.

| Actor                         | Event               | USD per event |
| ----------------------------- | ------------------- | ------------- |
| `cprussin/trustpilot-reviews` | `review`            | $0.0005       |
| `cprussin/trustpilot-reviews` | `apify-actor-start` | $0.00005      |
| `cprussin/app-store-reviews`  | `review`            | $0.0005       |
| `cprussin/app-store-reviews`  | `apify-actor-start` | $0.00005      |

Tell the user the expected cost (limit x price) before a large run.

## When a run fails

- `FAILED` with `Invalid input: ...`: fix the field named in the message and rerun.
- `FAILED` with `All companies failed: ...` or `All apps failed: ...`: usually a temporary block or outage upstream. Retry later; for Trustpilot or very large app runs, try `"proxyConfiguration": {"useApifyProxy": true}`. Report persistent failures on the actor's Apify Issues tab.
- `SUCCEEDED` with fewer reviews than expected: read the run's status message. It gives per-company or per-app counts or status (such as not found or failed) and ends with `(stopped at max charge)` if the cost cap was hit. A run whose cap is below the price of one review exits with no items. Stores also expose fewer text reviews than star ratings.
- `onlyNew: true` with an empty dataset can just mean no new reviews.
- `TIMED-OUT` or `ABORTED`: reviews saved before the stop stay in the dataset. Rerun with a lower limit or a longer timeout (`-t` in the CLI, `timeout` query parameter in the API).
