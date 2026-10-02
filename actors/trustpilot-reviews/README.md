# Trustpilot Reviews Scraper: reviews, ratings and TrustScore for any company

**Trustpilot Reviews Scraper** exports Trustpilot reviews for any company as clean JSON, CSV or Excel. Give it company domains (like `amazon.com`) or Trustpilot URLs, and each review comes back with its **star rating, title, full text, author, author country, publish date, date of experience, verification label and the company's reply**, plus the company's **TrustScore, total review count** and an optional company profile.

- ✅ **Reviews plus company data in one run.** No second actor needed for TrustScore or company details.
- ✅ **New-review alerts.** Turn on "Only new reviews" and schedule the actor daily: each run returns (and bills) only reviews it hasn't returned before. Or set "Only reviews since" for a fixed date cutoff.
- ✅ **Filter by stars and language**, sorted by most recent or most relevant.
- ✅ **More than Trustpilot's 200-review page limit.** Above 200 reviews the actor queries each star rating separately and merges them newest first, for up to 1,000 reviews per company and language.
- ✅ **Pay per review.** $0.50 per 1,000 reviews. No monthly rental.
- ✅ Fast: plain HTTP with retries and rate limiting. A headless browser opens only for a few seconds to pass Trustpilot's bot check. No proxy is needed for typical runs.

## What can you do with Trustpilot reviews?

- **Brand and reputation monitoring:** schedule a daily run with `onlyNew` and route new 1–2 star reviews to Slack, email or your helpdesk.
- **Competitor analysis:** compare TrustScores, rating distributions and common complaints across your competitors.
- **Customer experience and product teams:** feed review text into sentiment analysis, topic modelling or an LLM to find recurring issues.
- **Agencies and consultants:** produce reputation audits and before/after reports for clients.
- **Lead generation:** find companies with poor ratings or low reply rates that might need a CX, support or review-management tool.
- **Market research and investing:** track customer satisfaction over time for retailers, fintechs, airlines or SaaS companies.

## How does the Trustpilot reviews scraper work?

1. Enter one or more companies as domains or Trustpilot review URLs.
2. The actor reads Trustpilot's public review pages and extracts the structured data embedded in each page (Next.js `__NEXT_DATA__` JSON), not fragile CSS selectors.
3. It pages through the reviews, 20 per page, with your star, language and date filters applied by Trustpilot itself. Duplicates are removed.
4. Each review is saved to the dataset and billed as one `review` event.

## How do I choose which Trustpilot reviews to scrape?

| Field                  | Description                                                                                  | Example                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `companies`            | Company domains or Trustpilot review URLs                                                    | `["amazon.com", "https://www.trustpilot.com/review/www.gymshark.com"]` |
| `maxReviewsPerCompany` | Max reviews per company (1–1,000)                                                            | `100`                                                                  |
| `stars`                | Only these star ratings (empty = all)                                                        | `["1", "2"]`                                                           |
| `language`             | `all` or a 2-letter language code                                                            | `"en"`                                                                 |
| `sort`                 | `recency` (most recent) or `relevance`                                                       | `"recency"`                                                            |
| `sinceDate`            | Delta mode: only reviews published on or after this date (YYYY-MM-DD)                        | `"2026-09-01"`                                                         |
| `onlyNew`              | Monitoring: only reviews not returned by an earlier run with the same input (see FAQ)        | `true`                                                                 |
| `includeCompanyInfo`   | Add a `company` object (website, categories, contact details, reply rate, star distribution) | `true`                                                                 |
| `proxyConfiguration`   | Optional Apify Proxy settings                                                                | `{ "useApifyProxy": false }`                                           |

Example input: new negative reviews for two companies since September 1.

```json
{
  "companies": [
    "amazon.com",
    "https://www.trustpilot.com/review/www.gymshark.com"
  ],
  "maxReviewsPerCompany": 200,
  "stars": ["1", "2"],
  "language": "all",
  "sinceDate": "2026-09-01",
  "includeCompanyInfo": false
}
```

## What data do you get for each Trustpilot review?

One dataset item per review:

```json
{
  "companyDomain": "gymshark.com",
  "companyName": "Gymshark",
  "trustScore": 4.3,
  "totalReviews": 41930,
  "reviewId": "6abb2f0e8a1c4d5e6f708192",
  "rating": 5,
  "title": "Great fit and fast delivery",
  "text": "Ordered two pairs of leggings, arrived in two days and the fit is perfect.",
  "author": "Sam K",
  "authorCountry": "GB",
  "authorReviewCount": 3,
  "date": "2026-09-29T15:59:39.000Z",
  "experienceDate": "2026-09-27",
  "updatedDate": null,
  "verified": true,
  "verificationSource": "invitation",
  "companyReply": "Hey Sam! Thanks so much for the lovely review...",
  "companyReplyDate": "2026-09-29T16:30:11.000Z",
  "language": "en",
  "likes": 0,
  "url": "https://www.trustpilot.com/reviews/6abb2f0e8a1c4d5e6f708192",
  "company": {
    "trustpilotId": "4bdc3e4000006400050bd2c5",
    "websiteUrl": "https://www.gymshark.com",
    "stars": 4.5,
    "isClaimed": true,
    "isClosed": false,
    "country": "GB",
    "categories": ["Sportswear Store", "Clothing Store"],
    "email": null,
    "phone": null,
    "address": null,
    "city": null,
    "zipCode": null,
    "replyPercentage": 62.5,
    "averageDaysToReply": 1,
    "ratingDistribution": {
      "1": 7000,
      "2": 1382,
      "3": 1103,
      "4": 1730,
      "5": 30715
    },
    "profileUrl": "https://www.trustpilot.com/review/gymshark.com"
  }
}
```

(This is an illustrative record.)

**Field notes**

- `date` is when the review was published. `experienceDate` is the date of experience the reviewer entered.
- `verified` and `verificationSource` reflect Trustpilot's own labels (for example `invitation` for reviews collected through a company's invitation).
- `companyDomain` is Trustpilot's identifier for the company, which is usually its domain. `amazon.com` and `www.amazon.com` resolve to the same profile and are only scraped once.
- `company` appears only when `includeCompanyInfo` is on. Fields a company hasn't filled in are `null`.
- The dataset's **Overview** view shows the main columns. Export as JSON, CSV, Excel, XML or HTML, or pull it through the Apify API.

## How much does it cost to scrape Trustpilot reviews?

Pay per event:

| Event    | Price                   | When                             |
| -------- | ----------------------- | -------------------------------- |
| `review` | $0.0005 ($0.50 / 1,000) | Each review saved to the dataset |

- 1,000 reviews cost $0.50; 10,000 reviews cost $5.
- Apify's standard small actor-start fee applies. The actor stops cleanly when it reaches your run's maximum charge, and you are never billed for more reviews than it returns.
- `onlyNew`, delta mode and filters are applied before billing: skipped reviews are free.

## Trustpilot scraper FAQ

**Is it legal to scrape Trustpilot?**
The actor only collects publicly visible review pages, the same data any visitor sees without logging in. Reviews contain personal data such as reviewer names. You are responsible for using the data lawfully (e.g. GDPR) and in line with Trustpilot's terms. If in doubt, ask a lawyer.

**Do I need a Trustpilot account or API key?**
No.

**Do I need a proxy?**
Usually not. The actor passes Trustpilot's automated browser check once per run with a headless browser, then fetches pages over plain HTTP. If you scrape many companies and see blocking, turn on Apify Proxy (residential works best).

**How many reviews can I get per company?**
Trustpilot shows logged-out visitors 10 pages (200 reviews) per filter combination. Above 200, the actor queries each star rating separately, which gives up to 1,000 reviews per company per language. With a single star rating selected, the limit is 200. To collect more, run the actor per language or use delta mode on a schedule to build up history.

**How do I get alerts for new reviews?**
Schedule this actor daily (Apify Console, Schedules; or save a task and schedule it) with `"onlyNew": true`:

1. The first run returns the latest reviews (up to `maxReviewsPerCompany`) as a baseline. Also set `sinceDate` for a smaller baseline.
2. Every later run returns only reviews not returned before, and stops paging a few days before the newest review it has seen, so a quiet day costs almost nothing.
3. Add a Slack, email or webhook integration to the task to get new reviews as alerts.

The "seen" state lives in your account, in the key-value store `trustpilot-reviews-state`, one record per combination of companies, star filter and language. Changing any of these starts a new baseline. Delete the record to reset.

For a one-off cutoff instead, set `sinceDate` to the date of your previous run.

**Which Trustpilot domains work?**
Any. URLs from country sites such as `uk.trustpilot.com` or `de.trustpilot.com` are accepted; all countries share one review database.

**What happens if a company isn't on Trustpilot?**
It's logged as "no Trustpilot profile found" and the run continues with the other companies.

**Can I use it through the API, Make, Zapier or an AI agent?**
Yes. Like any Apify actor, you can call it from the Apify API, the JavaScript and Python clients, integrations such as Make and Zapier, or the Apify MCP server.

## What are the limits of scraping Trustpilot?

- Only public reviews are available. Trustpilot hides some reviews (for example flagged or pending ones), and those are not returned.
- Trustpilot can change its site or bot protection at any time. The actor is tested daily; if something breaks, open an issue on the actor's Issues tab.
- It doesn't support Trustpilot product reviews, business search or category listings.

## Related actors

- [app-store-reviews](https://apify.com/cprussin/app-store-reviews): App Store and Google Play reviews for any app.
- [google-ads-transparency](https://apify.com/cprussin/google-ads-transparency): Ads from the Google Ads Transparency Center by advertiser or domain.
- [aliexpress-scraper](https://apify.com/cprussin/aliexpress-scraper): AliExpress product search results, prices and buyer reviews.
