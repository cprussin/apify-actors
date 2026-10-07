# App Store & Google Play Reviews Scraper

**App Store & Google Play Reviews Scraper** downloads user reviews from the **Apple App Store** and **Google Play** in one run and returns them in **one normalized schema**: star rating, title, review text, author, date, app version, developer reply (with its date), helpful votes, country, language and a link. Paste app URLs or IDs; the store is detected automatically.

- ✅ **Both stores, one schema.** Compare your iOS and Android reviews, or yours against a competitor's, without merging two formats.
- ✅ **Developer replies** and reply dates on both stores, so you can measure response rate and response time.
- ✅ **App version** on each review, so you can tie complaints to a release.
- ✅ **New-review alerts.** Turn on `onlyNew` and schedule the actor daily: each run returns (and bills) only reviews it hasn't returned before. Or set `sinceDate` (e.g. `"7 days"`) for a date cutoff.
- ✅ Filter by **star rating** (e.g. 1–2 stars for complaints only), **country** and **language**.
- ✅ Public store endpoints. No login, no API key and normally no proxy needed.
- ✅ Pay only per review returned.

## Who uses App Store and Google Play reviews?

- **Product managers and mobile teams** track bugs and feature requests after every release, per app version.
- **Customer support and community teams** find unanswered negative reviews and measure developer-reply coverage.
- **Competitive intelligence and market research**: see what users love and hate about competing apps, in every country.
- **ASO (App Store Optimization) specialists** mine review language for keywords and monitor rating trends.
- **Data scientists and AI teams** build sentiment-analysis, topic-modeling or LLM-summarization datasets.
- **Agencies** send clients weekly review digests via Apify integrations (Google Sheets, Slack, email, webhooks).

## How does the app review scraper work?

1. Add apps as URLs or IDs. Anything is accepted:
   - App Store: `https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580`, `id324684580` or `324684580`
   - Google Play: `https://play.google.com/store/apps/details?id=com.spotify.music` or `com.spotify.music`
   - iOS bundle ID: prefix it with `apple:`, e.g. `apple:com.spotify.client`
2. Pick a country, language, sort order and how many reviews you want per app.
3. The actor pages through each store's public review feed, retries rate limits and network errors with backoff, removes duplicates, applies your filters and writes one dataset item per review.
4. If an app doesn't exist in the chosen country, it is logged and skipped; the rest of the run continues.

## How do I choose which app reviews to scrape?

| Field                | Description                                                                                                         | Example                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `apps`               | App Store / Google Play URLs or IDs (store auto-detected)                                                           | `["id324684580", "com.whatsapp"]` |
| `country`            | Two-letter store country                                                                                            | `"us"`, `"gb"`, `"de"`            |
| `language`           | Review language (Google Play only; the App Store has no language filter)                                            | `"en"`                            |
| `sort`               | `newest` or `mostRelevant` (App Store "most helpful", Google Play "most relevant")                                  | `"newest"`                        |
| `maxReviewsPerApp`   | Stop after this many reviews per app                                                                                | `500`                             |
| `sinceDate`          | Only reviews on or after this date: `YYYY-MM-DD`, ISO timestamp, or relative (`"7 days"`, `"2 weeks"`, `"1 month"`) | `"7 days"`                        |
| `onlyNew`            | Monitoring: only reviews not returned by an earlier run with the same input (see Tips)                              | `true`                            |
| `minRating`          | Minimum stars (1–5)                                                                                                 | `4`                               |
| `maxRating`          | Maximum stars (1–5)                                                                                                 | `2`                               |
| `proxyConfiguration` | Optional Apify Proxy for very large runs                                                                            | `{ "useApifyProxy": true }`       |

Example: every 1–2 star review from the last week for two competing apps, on both stores.

```json
{
  "apps": [
    "https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580",
    "com.spotify.music",
    "https://apps.apple.com/us/app/pandora-music-podcasts/id284035177",
    "com.pandora.android"
  ],
  "country": "us",
  "language": "en",
  "sort": "newest",
  "sinceDate": "7 days",
  "maxRating": 2,
  "maxReviewsPerApp": 1000
}
```

## What data does each app review include?

One dataset item per review. App Store example:

```json
{
  "store": "apple",
  "appId": "324684580",
  "appName": "Spotify: Music and Podcasts",
  "reviewId": "14603399497",
  "rating": 5,
  "title": "Always there",
  "text": "Thanks Spotify for keeping the music going offline out in the back woods!",
  "author": "zephyr322",
  "date": "2026-09-28T13:34:02.000Z",
  "appVersion": "9.1.86",
  "developerReply": null,
  "developerReplyDate": null,
  "helpfulCount": 0,
  "country": "us",
  "language": null,
  "url": "https://apps.apple.com/us/app/id324684580?see-all=reviews"
}
```

Google Play example:

```json
{
  "store": "google",
  "appId": "com.robinhood.android",
  "appName": "Robinhood: Trading & Investing",
  "reviewId": "b09bffa7-10fd-42bb-9200-65b89bc23e9b",
  "rating": 1,
  "title": null,
  "text": "…",
  "author": "…",
  "date": "2026-09-28T16:23:52.000Z",
  "appVersion": "2026.38.6",
  "developerReply": "Please reach out at reviews@robinhood.com. We’ll take a closer look and do our best to find a fix quickly.",
  "developerReplyDate": "2026-09-28T16:41:28.000Z",
  "helpfulCount": 0,
  "country": "us",
  "language": "en",
  "url": "https://play.google.com/store/apps/details?id=com.robinhood.android&hl=en&gl=us&reviewId=b09bffa7-10fd-42bb-9200-65b89bc23e9b"
}
```

(Shortened examples; real runs return the full text.)

**Field notes**

- `date` and `developerReplyDate` are ISO 8601 UTC timestamps.
- `title`: Google Play reviews have no title, so it is always `null` there.
- `helpfulCount`: "helpful" votes on the App Store, thumbs-up on Google Play.
- `appVersion`: on Google Play it comes with every review (when the reviewer's version is known). On the App Store it is available for roughly the **500 most recent reviews** per country; older App Store reviews have `null`.
- `language`: the language requested from Google Play. `null` for App Store reviews, which Apple doesn't filter by language (you get every review posted in that country's store).
- `url`: Google Play links to the individual review; the App Store has no per-review page, so it links to the app's reviews page.
- `author` is the public nickname shown in the store.

## How much does it cost to scrape app reviews?

Pay-per-event, only for what you get:

| Event                            | Price       |
| -------------------------------- | ----------- |
| Review (one item in the dataset) | **$0.0005** |

That's **$0.50 per 1,000 reviews**, for both stores combined. Filtered-out and duplicate reviews are not charged. If you set a **maximum cost per run**, the actor stops cleanly when it reaches it.

## Tips for scraping App Store and Google Play reviews

- **Daily new-review alerts:** schedule this actor daily (Apify Console, Schedules; or save a task and schedule it) with `"onlyNew": true`. The first run returns the latest reviews (up to `maxReviewsPerApp`) as a baseline; every later run returns only reviews not returned before and stops paging a few days before the newest one it has seen, so a quiet day costs almost nothing. Add a Slack, email or webhook integration to the task for alerts. State lives in your account in the key-value store `app-store-reviews-state`, one record per combination of apps, country, language and rating filter; changing any of these starts a new baseline.
- **Weekly review digest:** schedule the actor with `sinceDate: "7 days"` and sort = Newest, and pipe the dataset to Google Sheets, Slack or email with Apify integrations.
- **Complaint tracking:** `maxRating: 2` returns only 1–2 star reviews. Combine with `appVersion` to spot a bad release.
- **Multiple countries:** App Store reviews are separate per country. Run once per country (e.g. `us`, `gb`, `de`) to cover them.
- **Google Play language:** Google returns reviews in the requested `language`. For all reviews from Germany in German, use `country: "de"`, `language: "de"`.
- Very large pulls (hundreds of thousands of reviews) may hit store rate limits. The actor backs off automatically; add Apify Proxy if it keeps happening.

## App review scraper FAQ

**How many reviews can I get?** Google Play serves its full review history through pagination. The App Store feed also goes deep for popular apps, but Apple decides how much history it exposes, and this varies by app and country. `maxReviewsPerApp` caps each app.

**Does it need a login, API key or App Store Connect access?** No. It reads the same public review data anyone can see in the stores. It cannot read private feedback or reviews for apps you don't have listed publicly.

**Why do I get fewer reviews than the store's rating count?** Most ratings are stars only, without text. Stores only publish ratings that come with a written review.

**Why is `appName` localized?** The name comes from the store in the chosen country/language, e.g. a German title for `country: "de"`.

**Can I use it through the API or with AI agents?** Yes. Call it through the Apify API, the Apify MCP server or any Apify integration. Pricing is per event only, so agent payments work too.

**Is scraping app reviews legal?** The actor only collects publicly available reviews. Reviews contain user nicknames and free text, so you are responsible for how you store and use them (e.g. GDPR) and for complying with the stores' terms.

**Disclaimer:** This actor is not affiliated with, endorsed by or sponsored by Apple or Google. App Store is a trademark of Apple Inc.; Google Play is a trademark of Google LLC.

## Related actors

- [app-store-apps](https://apify.com/cprussin/app-store-apps?fpr=to54nm): App Store keyword ranks, App Store and Google Play top charts and app details.
- [trustpilot-reviews](https://apify.com/cprussin/trustpilot-reviews?fpr=to54nm): Trustpilot reviews, ratings and TrustScore for any company.
- [product-hunt-launches](https://apify.com/cprussin/product-hunt-launches?fpr=to54nm): Product Hunt launches, leaderboards, upvotes and makers.
- [google-trends](https://apify.com/cprussin/google-trends?fpr=to54nm): Google Trends interest over time, regions, related queries and trending searches.
