# Google Trends Scraper: Interest, Regions, Related & Trending

**Google Trends Scraper** exports Google Trends data as clean JSON, CSV or Excel. There's no official Google Trends API for most people (the alpha has a waitlist), so this actor reads the same data the trends.google.com website shows:

- ✅ **Interest over time** for any search term: minute, hourly, daily, weekly or monthly points from 2004 to now.
- ✅ **Interest by region**: countries, states/provinces, **US metro areas (DMA)** or cities.
- ✅ **Related queries**, both **Top** and **Rising** (including "Breakout"). **Related topics** too, when Google returns them (see FAQ).
- ✅ **Trending now**: the searches trending in a country over the past 4 hours to 7 days, with search volume, % increase, start/end time, category and related queries.
- ✅ **Compare more than 5 keywords on one scale.** Google compares at most 5 terms per chart. The actor batches larger lists and repeats your first term in every batch as an anchor, then rescales all terms onto one 0–100 scale (`normalizedValue`).
- ✅ Filter by **location**, **timeframe** (presets or custom dates), **category** and **search type**: Web, News, Images, YouTube or Google Shopping.
- ✅ Handles Google's rate limits and flaky proxies: switches to a new proxy IP on every failed request (429, captcha, timeout, 5xx), falls back to direct requests when the proxy is down, and caps retry time.
- ✅ Pay only for results that contain data. Empty results are free.

## Who uses Google Trends data?

- **SEO and content teams**: find rising queries and topics to write about, and check a keyword's seasonality before investing in it.
- **Marketers and brand managers**: compare brand vs competitors over time and by region, and pick the regions or metros where to spend ad budget.
- **E-commerce and product teams**: spot rising product demand early with Google Shopping and YouTube search interest.
- **Investors, analysts and researchers**: use search interest as an alternative-data signal alongside sales, stock or survey data.
- **Newsrooms and social media teams**: monitor what's trending right now in any country.
- **Data scientists and AI agents**: feed Trends data into models, dashboards or LLM workflows via the Apify API or MCP server.

## How does the Google Trends scraper work?

1. Add search terms (Explore mode) or pick **Trending now**.
2. Choose location, timeframe, category, search type and which datasets you want.
3. The actor calls Google Trends' own web endpoints (explore → widget data), the same way the website does, and returns one dataset item per **search term × dataset**.
4. If a term has too little search volume for a dataset, you still get the item (with `hasData: false`, `rows: []`), and you're not charged for it.

## How do I choose Google Trends terms, regions and timeframes?

| Field                     | Description                                                                                                      | Example                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `mode`                    | `explore` (your search terms) or `trendingNow`                                                                   | `"explore"`                   |
| `searchTerms`             | Keywords. Any number; more than 5 are batched automatically, anchored on the first term                          | `["coffee", "tea", "matcha"]` |
| `datasets`                | Any of `interestOverTime`, `interestByRegion`, `relatedQueries`, `relatedTopics`                                 | `["interestOverTime"]`        |
| `geo`                     | Empty = worldwide, or country `US`, region `US-CA`, metro `US-NY-501`                                            | `"GB"`                        |
| `timeframe`               | `now 1-H`, `now 4-H`, `now 1-d`, `now 7-d`, `today 1-m`, `today 3-m`, `today 12-m`, `today 5-y`, `all`, `custom` | `"today 5-y"`                 |
| `startDate` / `endDate`   | Custom range, `YYYY-MM-DD` (or `YYYY-MM-DDTHH` for hourly data within 7 days)                                    | `"2024-01-01"`                |
| `category`                | Google Trends category ID (0 = all; e.g. 7 Finance, 71 Food & Drink, 20 Sports)                                  | `71`                          |
| `property`                | `web`, `news`, `images`, `youtube`, `froogle` (Google Shopping)                                                  | `"youtube"`                   |
| `regionResolution`        | `auto`, `COUNTRY`, `REGION`, `DMA` (US metros), `CITY`                                                           | `"DMA"`                       |
| `includeLowVolumeRegions` | Also return regions without enough data                                                                          | `false`                       |
| `language`                | Interface language for names and labels                                                                          | `"en-US"`                     |
| `trendingHours`           | Trending now window: `4`, `24`, `48` or `168` hours                                                              | `"24"`                        |
| `maxTrendingSearches`     | Max trending searches to return                                                                                  | `50`                          |
| `onlyNew`                 | Trending now monitoring: only searches not returned by an earlier run for the same country                       | `true`                        |
| `proxyConfiguration`      | Apify Proxy (on by default; Google rate-limits single IPs quickly)                                               | `{ "useApifyProxy": true }`   |

Example: five years of YouTube search interest for three brands in the US, by metro area.

```json
{
  "searchTerms": ["nike", "adidas", "puma"],
  "geo": "US",
  "timeframe": "today 5-y",
  "property": "youtube",
  "datasets": ["interestOverTime", "interestByRegion"],
  "regionResolution": "DMA"
}
```

## What Google Trends data do you get?

Every Explore item has the same fields; `rows` depends on `dataset`.

```json
{
  "dataset": "interestOverTime",
  "term": "coffee",
  "geo": "US",
  "timeframe": "today 12-m",
  "category": 0,
  "property": "web",
  "resolution": null,
  "comparedWith": ["tea"],
  "anchorTerm": null,
  "hasData": true,
  "rowCount": 53,
  "rows": [
    {
      "date": "2025-09-28T00:00:00.000Z",
      "formattedTime": "Sep 28 – Oct 4, 2025",
      "value": 74,
      "normalizedValue": 74,
      "hasData": true,
      "isPartial": false
    }
  ],
  "exploreUrl": "https://trends.google.com/trends/explore?q=coffee%2Ctea&date=today+12-m&geo=US&hl=en-US"
}
```

Row shapes per dataset:

- `interestOverTime`: `date` (ISO, UTC), `formattedTime`, `value` (0–100, relative to the highest point among the terms in the same request), `normalizedValue` (0–100 across **all** your terms; see below), `hasData`, `isPartial` (the latest, incomplete period).
- `interestByRegion`: `geoCode` (e.g. `US-CA`, DMA code `807`), `geoName`, `value` (0–100), `hasData`, `coordinates` (cities only).
- `relatedQueries`: `ranking` (`top` / `rising`), `rank`, `query`, `value`, `formattedValue` (e.g. `"100"`, `"+250%"`, `"Breakout"`), `isBreakout`, `link`.
- `relatedTopics`: same as related queries, with `topicId` (Knowledge Graph ID like `/m/02vqfm`), `title` and `topicType` instead of `query`.

Trending now items:

```json
{
  "dataset": "trendingNow",
  "term": "national coffee day",
  "geo": "US",
  "timeframe": "past 24 hours",
  "searchVolume": 100000,
  "increasePercent": 1000,
  "startedAt": "2026-09-28T23:00:00.000Z",
  "endedAt": null,
  "isActive": true,
  "categories": ["Food and Drink"],
  "relatedQueries": ["national coffee day deals", "free coffee today"],
  "newsArticleCount": 9,
  "exploreUrl": "https://trends.google.com/trends/explore?q=national+coffee+day&date=now+1-d&geo=US&hl=en-US"
}
```

`searchVolume` is Google's rounded lower bound (e.g. 100000 = "100K+").

### Comparing more than 5 terms

Google Trends scales every chart so that its highest point is 100, and it compares at most 5 terms at a time. With 6+ terms the actor sends batches of 5 that all include your **first** term (the anchor). It rescales each batch by the anchor's total interest in it, so `normalizedValue` puts every term on one 0–100 scale. `value` stays exactly what Google returned for that batch.

The anchor works best when it's reasonably popular throughout the timeframe. If the anchor has zero interest in a batch, that batch's `normalizedValue` is `null`, and the run log says so. Rescaling rounds Google's integer values, so very small terms lose precision, just as they do on the website.

## How much does it cost to scrape Google Trends?

Pay-per-event, only for results with data:

| Event                                                         | Price      |
| ------------------------------------------------------------- | ---------- |
| Trend result (one term × dataset, or one trending-now search) | **$0.002** |

That's **$2 per 1,000 results**. One result holds a whole time series, region table or related list (up to 50 rows), not one row. The default input (2 terms × 3 datasets) costs $0.012. Results without data are free. If you set a **maximum cost per run**, the actor stops cleanly when it reaches it.

## Tips for scraping Google Trends

- **Keyword research:** set `datasets: ["relatedQueries"]` and look at rows with `ranking: "rising"`. `isBreakout` marks queries that grew more than 5000%.
- **Seasonality:** use `timeframe: "today 5-y"` for weekly data, or `all` for monthly data since 2004.
- **Daily data for a long period:** Google returns daily points for ranges up to ~9 months. Use custom `startDate`/`endDate` windows.
- **Monitoring:** schedule Trending now every few hours with `onlyNew: true` (see below) and send new items to Slack, Google Sheets or a webhook with Apify integrations.
- **Topics vs search terms:** Google Trends compares exact search terms here. Related topics give you Knowledge Graph IDs (`topicId`) if you need entity-level data.

## How do I monitor Google Trends for new items?

Use mode `trendingNow`, turn on `onlyNew` and run the actor on an [Apify schedule](https://docs.apify.com/platform/schedules) (e.g. every few hours; save the input as a task and schedule the task).

- The first run is a baseline and returns trending searches as usual. Later runs return, and charge for, only searches (by term) not returned before. Skipped searches are never charged. `maxTrendingSearches` counts only new ones.
- `onlyNew` is ignored in Explore mode: its results are time series and rankings that change every run, not new items. Schedule Explore runs and compare them instead.
- State lives in your account in the key-value store `google-trends-state`, one record per country. It remembers the latest 50,000 searches.
- Add a Slack, email or webhook integration to the task to get alerts.

## Google Trends scraper FAQ

**Is this the official Google Trends API?** No. It reads the public data that the trends.google.com website loads. Values are identical to what you see in the browser for the same settings.

**Why do values differ between runs?** Google Trends computes values from a sample of searches, so numbers can shift slightly between requests, especially for low-volume terms and short timeframes. Values are always relative (0–100), never absolute search counts.

**Do I need a proxy?** Google rate-limits Trends heavily per IP (often after a dozen or so requests). Apify Proxy is enabled by default, and the actor switches IP automatically when it's throttled. Large runs take longer when Google throttles, but they keep going.

**Why are some rising queries unrelated to my term?** Rising queries are what Google returns: the terms whose share grew the most among searches containing your term. For broad terms and long timeframes these can be noisy.

**Why are related topics empty?** As of September 2026, Google Trends' endpoint returns an empty related-topics list for the requests we tested, so `relatedTopics` is off by default. If you enable it, empty results come back with `hasData: false` and are **not charged**. They fill in automatically if Google serves the data again.

**Can I use it through the API or with AI agents?** Yes. Call it through the Apify API, the Apify MCP server or any Apify integration. Pricing is per event only, so agent payments work too.

**Disclaimer:** This actor is not affiliated with, endorsed by or sponsored by Google. Google Trends is a trademark of Google LLC. You are responsible for complying with Google's terms when using the data.

## Related actors

- [google-ads-transparency](https://apify.com/cprussin/google-ads-transparency?fpr=to54nm): Ads from the Google Ads Transparency Center by advertiser or domain.
- [product-hunt-launches](https://apify.com/cprussin/product-hunt-launches?fpr=to54nm): Product Hunt launches, leaderboards, upvotes and makers.
- [youtube-transcripts](https://apify.com/cprussin/youtube-transcripts?fpr=to54nm): Captions and transcripts from YouTube videos and channels.
