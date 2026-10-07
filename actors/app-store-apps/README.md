# App Store & Google Play Scraper: Keyword Ranks, Charts, Details

**App Store & Google Play Scraper** returns app data from the **Apple App Store** and **Google Play** in **one normalized schema**. Three modes:

- 🔎 **Keyword ranks (ASO):** where every app ranks in **App Store search** for your keywords, with full app metadata on each row. Track your own apps only, or the whole top 200.
- 🏆 **Top charts:** **top free, top paid and top grossing** apps on the **App Store and Google Play**, by country and category (games, finance, productivity, ...).
- 📱 **App details:** full metadata for any app by URL or ID: name, developer, rating, ratings count, installs, price, in-app purchases, version, release and update dates, size, content rating, screenshots, website and more.

Plus:

- ✅ **Rank-change alerts.** Turn on `rankChangesOnly` and schedule the actor daily: each run returns (and bills) only apps that moved up, moved down, entered or dropped out, with their previous rank.
- ✅ **Both stores, one schema.** Same fields for iOS and Android, so you can compare stores, countries and competitors in one table.
- ✅ Public store data: Apple's official iTunes Search and Lookup APIs and RSS chart feeds, and public Google Play pages. No login, API key or proxy.
- ✅ Pay per result. Failed queries and apps that don't exist are free.

## Who uses App Store and Google Play app data?

- **ASO (App Store Optimization) specialists** track keyword rankings for their apps and competitors, every day, in every country.
- **Mobile marketers and growth teams** watch top charts to spot rising competitors and measure launches and campaigns.
- **Product managers and analysts** compare ratings, prices, update cadence and in-app purchase ranges across a category.
- **Investors and market researchers** monitor top-grossing charts and new entrants by category and country.
- **Agencies** send clients weekly rank and chart reports via Apify integrations (Google Sheets, Slack, email, webhooks).

## How does it work?

1. Pick a **mode** and fill in its section:
   - **Keyword ranks:** add keywords such as `photo editor` or `budget tracker`. Optionally list your apps in `trackedApps` to get only their rows.
   - **Top charts:** pick charts (top free / paid / grossing), stores and a category.
   - **App details:** add App Store or Google Play URLs or IDs. The store is detected automatically.
2. Pick a **country** (and a Google Play display **language**) and how many ranks you want per keyword or chart.
3. The actor calls the stores at a polite pace, retries rate limits and errors with backoff, and writes one dataset item per ranked app or app.

## Input

| Field             | Description                                                                       | Example                                |
| ----------------- | --------------------------------------------------------------------------------- | -------------------------------------- |
| `mode`            | `keywordRanks`, `topCharts` or `appDetails`                                       | `"keywordRanks"`                       |
| `keywords`        | App Store search terms (keyword ranks)                                            | `["photo editor", "collage maker"]`    |
| `trackedApps`     | Only output these App Store apps per keyword, plus a `notRanked` row if absent    | `["id587366035"]`                      |
| `charts`          | `topFree`, `topPaid`, `topGrossing` (top charts)                                  | `["topFree", "topGrossing"]`           |
| `stores`          | `apple`, `google` (top charts)                                                    | `["apple", "google"]`                  |
| `category`        | Chart category: `all`, `games`, `finance`, `productivity`, `photoAndVideo`, ...   | `"games"`                              |
| `apps`            | App Store / Google Play URLs or IDs (app details)                                 | `["id324684580", "com.spotify.music"]` |
| `country`         | Two-letter store country                                                          | `"us"`, `"gb"`, `"de"`                 |
| `language`        | Google Play display language                                                      | `"en"`                                 |
| `maxResults`      | Ranks per keyword or chart (App Store search 200, App Store charts 100, Play 200) | `50`                                   |
| `rankChangesOnly` | Only rows whose rank changed since the last run with the same input (see Tips)    | `true`                                 |
| `minRankChange`   | With `rankChangesOnly`: ignore moves smaller than this many places                | `3`                                    |

Example: daily top-grossing games on both stores in Germany, changes only.

```json
{
  "mode": "topCharts",
  "charts": ["topGrossing"],
  "stores": ["apple", "google"],
  "category": "games",
  "country": "de",
  "language": "de",
  "maxResults": 100,
  "rankChangesOnly": true
}
```

Example: where do my apps rank for three keywords?

```json
{
  "mode": "keywordRanks",
  "keywords": ["photo editor", "collage maker", "ai photo"],
  "trackedApps": [
    "https://apps.apple.com/us/app/picsart-ai-photo-editor-video/id587366035"
  ],
  "maxResults": 200
}
```

## What data do you get?

Every item has the same fields; fields a store or mode doesn't provide are `null`. A keyword-rank row (shortened):

```json
{
  "type": "keywordRank",
  "store": "apple",
  "keyword": "photo editor",
  "chart": null,
  "chartCategory": null,
  "rank": 1,
  "previousRank": null,
  "rankChange": null,
  "changeType": null,
  "appId": "587366035",
  "bundleId": "com.picsart.studio",
  "name": "Picsart AI Photo Editor, Video",
  "developer": "PicsArt, Inc.",
  "developerId": "587366038",
  "url": "https://apps.apple.com/us/app/picsart-ai-photo-editor-video/id587366035",
  "category": "Photo & Video",
  "genres": ["Photo & Video", "Graphics & Design"],
  "price": 0,
  "currency": "USD",
  "free": true,
  "rating": 4.66528,
  "ratingCount": 1195732,
  "version": "30.9.2",
  "releaseDate": "2013-01-02T22:14:40.000Z",
  "updatedDate": "2026-10-06T04:02:28.000Z",
  "contentRating": "12+",
  "sizeBytes": 270485504,
  "minOsVersion": "15.0",
  "website": "https://picsart.com",
  "country": "us",
  "language": null,
  "scrapedAt": "2026-10-07T13:20:00.000Z",
  "error": null
}
```

A Google Play app-details row (shortened):

```json
{
  "type": "app",
  "store": "google",
  "appId": "com.spotify.music",
  "name": "Spotify: Music and Podcasts",
  "developer": "Spotify AB",
  "summary": "Listen to songs, play podcasts, create playlists and discover music you'll love",
  "category": "Music & Audio",
  "categoryId": "MUSIC_AND_AUDIO",
  "price": 0,
  "free": true,
  "inAppPurchases": "$4.99 - $203.88 per item",
  "containsAds": true,
  "rating": 4.3473573,
  "ratingCount": 36442712,
  "reviewCount": 1855393,
  "ratingHistogram": [3715976, 1064431, 1312740, 3101335, 27248207],
  "installs": "1,000,000,000+",
  "minInstalls": 1000000000,
  "updatedDate": "2026-10-05T…",
  "contentRating": "Teen",
  "developerEmail": "support@spotify.com",
  "privacyPolicyUrl": "https://www.spotify.com/legal/privacy-policy/",
  "url": "https://play.google.com/store/apps/details?id=com.spotify.music&hl=en&gl=us"
}
```

**Field notes**

- `type`: `keywordRank`, `chartRank`, `app` or `error` (a failed keyword, chart or app; free).
- `rank`: 1 = top. Keyword ranks are positions in Apple's official Search API results, which closely track, but can differ slightly from, what the App Store app shows a given user.
- `rankChangesOnly` rows: `previousRank`, `rankChange` (positive = moved up) and `changeType`: `baseline` (first run), `new` (entered the top N), `up`, `down` or `dropped` (left the top N; `rank` is its new position below the top N, or `null` if it's gone from the list).
- `changeType: "notRanked"`: a `trackedApps` app isn't in the top `maxResults` for that keyword.
- App Store rows have full metadata in every mode. Google Play **chart** rows have name, developer, icon, category, price, rating, installs, content rating and description; run **app details** for the rest (rating counts, histogram, version, dates, contact).
- Google Play `version` is `null` for apps that show "Varies with device".
- `language` is the Google Play display language; App Store text comes in the country's default language.

## How much does it cost?

Pay per event, no start fee:

| Event                                               | Price                         |
| --------------------------------------------------- | ----------------------------- |
| Rank row (one app in a keyword search or top chart) | **$0.001** ($1 per 1,000)     |
| App (one app details record)                        | **$0.0015** ($1.50 per 1,000) |

Examples: 10 keywords × top 50 = 500 rank rows = $0.50. Four top-100 charts = $0.40. With `trackedApps`, you pay only for your apps' rows. With `rankChangesOnly`, unchanged ranks are free. Errors and missing apps are free. If you set a **maximum cost per run**, the actor stops cleanly when it's reached.

## Tips

- **Daily rank alerts:** save a task with `"rankChangesOnly": true`, schedule it daily, and add a Slack, email or webhook integration. The first run is a baseline; later runs return only movers, new entries and drop-outs. Apple's search order jitters by a place or two between calls, so set `minRankChange` to 3 for keyword alerts; small slides across the top-N cut-off are ignored too, because the actor always compares the full result list. State lives in your account in the key-value store `app-store-apps-ranks`, one record per combination of mode, keywords or charts, stores, category, country and `maxResults`; changing any of these starts a new baseline.
- **Your keyword positions only:** set `trackedApps` and `maxResults: 200` to see where your apps rank in the full result list while paying for one row per app and keyword.
- **Multiple countries:** ranks and charts are per country. Save one task per country.
- **Google Play keyword ranks** aren't offered; keyword ranks are App Store only.

## FAQ

**Is this the same ranking users see?** Charts come straight from Apple's and Google's chart feeds. Keyword ranks use Apple's official Search API, the closest public source for App Store search order; personalization and Search Ads in the App Store app aren't included.

**How fresh is the data?** Live at run time. Apple updates charts several times a day; Google Play roughly daily.

**Does it need a login, API key or proxy?** No.

**Can I use it through the API or with AI agents?** Yes: the Apify API, the Apify MCP server or any Apify integration. Pricing is per event only.

**Disclaimer:** This actor is not affiliated with, endorsed by or sponsored by Apple or Google. App Store is a trademark of Apple Inc.; Google Play is a trademark of Google LLC. You are responsible for complying with the stores' terms when using the data.

## Related actors

- [app-store-reviews](https://apify.com/cprussin/app-store-reviews?fpr=to54nm): App Store and Google Play reviews in one schema, with new-review alerts.
- [google-trends](https://apify.com/cprussin/google-trends?fpr=to54nm): Google Trends interest over time, regions, related queries and trending searches.
- [product-hunt-launches](https://apify.com/cprussin/product-hunt-launches?fpr=to54nm): Product Hunt launches, leaderboards, upvotes and makers.
