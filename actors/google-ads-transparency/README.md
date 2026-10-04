# Google Ads Transparency Scraper: Ads, Copy, Images & Video

**Google Ads Transparency Scraper** exports the ads any company runs on Google, straight from the [Google Ads Transparency Center](https://adstransparency.google.com), as JSON, CSV or Excel. Look up a competitor by **name**, **advertiser ID** or **website domain** and get every ad Google shows for them on **Search, YouTube, Maps, Play and Shopping**:

- ✅ **Ad creatives**: text, image and video ads, with creative ID and a link to the ad on the Transparency Center.
- ✅ **Ad copy** where Google renders it: headline, description, display URL, call to action and every visible text snippet.
- ✅ **Media**: image URLs, YouTube video ID and link, and the promoted app (app ID and name) for app-install ads.
- ✅ **Dates**: first shown, last shown and total days shown, so you can see how long an ad has been running.
- ✅ **Filters**: country, date range, format (text / image / video) and platform (Search, YouTube, Maps, Play, Shopping).
- ✅ **Advertiser lookup**: turn a brand name into Google's advertiser ID (AR…), with its country and ad count.
- ✅ **Search by domain**: every ad that points to `competitor.com`, from any advertiser (resellers and affiliates too).
- ✅ **No residential proxy needed.** Runs direct by default and falls back to Apify's datacenter proxy only if Google rate-limits.
- ✅ Pay only per ad returned. No start fee beyond Apify's minimum.

## Who uses Google Ads Transparency Center data?

- **Performance marketers and PPC agencies**: see which ads competitors run, how long they keep them running (long-running ads usually work), and which formats and platforms they use.
- **Creative strategists**: collect competitor image and video creatives for swipe files and ad inspiration.
- **Brand protection and affiliate managers**: find everyone advertising your domain or brand name.
- **Market researchers and investors**: track a company's ad volume, launches and campaigns over time.
- **Journalists and researchers**: audit advertisers in a given country or period.
- **AI agents and data pipelines**: call it through the Apify API or MCP server to answer "what ads is X running?".

## How does the Google Ads Transparency scraper work?

1. Add advertisers: names (`Nike`), advertiser IDs (`AR16735076323512287233`), Transparency Center URLs or domains (`nike.com`).
2. Pick a region, optional date range, formats and platform, and how many ads per advertiser.
3. The actor calls the same internal endpoints the Transparency Center website uses (advertiser search, creative search with pagination), then downloads each ad's preview to extract text, images and video.
4. A name is resolved to the best-matching advertiser (exact name first, then the one with the most ads). The run log says which advertiser was used. Use **Advertiser search** mode or an AR ID when a brand has several advertiser accounts.

## How do I choose which advertisers' ads to scrape?

| Field                    | Description                                                                                  | Example                      |
| ------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------- |
| `advertisers`            | Names, advertiser IDs (AR…), Transparency Center URLs or domains                             | `["Nike", "adidas.com"]`     |
| `mode`                   | `ads` (default) or `advertisers` (look up names → IDs, no ads)                               | `"ads"`                      |
| `maxAdsPerAdvertiser`    | Max ads per advertiser/domain; most recently shown first                                     | `100`                        |
| `region`                 | 2-letter country code where the ads were shown; empty = anywhere                             | `"GB"`                       |
| `formats`                | Any of `text`, `image`, `video`; empty = all                                                 | `["video"]`                  |
| `platform`               | `SEARCH`, `YOUTUBE`, `MAPS`, `PLAY` or `SHOPPING`; empty = all                               | `"YOUTUBE"`                  |
| `dateFrom` / `dateTo`    | Ads shown in this period. `YYYY-MM-DD` or relative (`30 days`)                               | `"30 days"`                  |
| `includeAdContent`       | Download ad previews for text, images and video (on by default). Off = faster, IDs and dates | `true`                       |
| `maxAdvertisersPerQuery` | Advertiser search mode: results per name                                                     | `10`                         |
| `onlyNew`                | Monitoring: only ads (or advertisers) not returned by an earlier run with the same input     | `true`                       |
| `proxyConfiguration`     | Optional. Off by default; datacenter proxy is enough                                         | `{ "useApifyProxy": false }` |

Example: the latest 50 YouTube video ads of two competitors in the US, from the last 90 days.

```json
{
  "advertisers": ["Nike", "adidas.com"],
  "region": "US",
  "formats": ["video"],
  "platform": "YOUTUBE",
  "dateFrom": "90 days",
  "maxAdsPerAdvertiser": 50
}
```

## What data do you get for each Google ad?

One item per ad:

```json
{
  "advertiserId": "AR16735076323512287233",
  "advertiserName": "Nike, Inc.",
  "creativeId": "CR12033629139320700929",
  "format": "video",
  "firstShown": "2026-09-11T07:00:00.000Z",
  "lastShown": "2026-09-29T17:36:48.000Z",
  "totalDaysShown": 19,
  "headline": "Magasin d’Usine Nike",
  "description": "See why Alysa Liu loves the oversized...",
  "displayUrl": null,
  "callToAction": null,
  "texts": [
    "Magasin d’Usine Nike",
    "Two Fits, Three Weights",
    "See why Alysa Liu loves the oversized...",
    "Learn more • www.nike.com/",
    "Directions"
  ],
  "appId": null,
  "appName": null,
  "appStore": null,
  "imageUrl": "https://tpc.googlesyndication.com/simgad/5234432554131272933",
  "imageUrls": ["https://tpc.googlesyndication.com/simgad/5234432554131272933"],
  "videoId": null,
  "videoUrl": null,
  "width": null,
  "height": null,
  "targetDomain": "nike.com",
  "region": "US",
  "platform": null,
  "adUrl": "https://adstransparency.google.com/advertiser/AR16735076323512287233/creative/CR12033629139320700929?region=US",
  "advertiserUrl": "https://adstransparency.google.com/advertiser/AR16735076323512287233?region=US",
  "previewUrl": "https://displayads-formats.googleusercontent.com/ads/preview/content.js?...",
  "query": "Nike"
}
```

- `format`: `text`, `image` or `video`, as Google classifies the ad.
- `firstShown` / `lastShown`: ISO timestamps (UTC). `totalDaysShown`: days the ad was shown.
- `headline`, `description`, `displayUrl`, `callToAction`, `texts`: best-effort extraction from Google's rendered preview; `null`/empty when the preview is only an image.
- `imageUrl`: the main image (or screenshot, or YouTube thumbnail); `imageUrls`: all images found.
- `videoId` / `videoUrl`: the YouTube video, when Google's preview references it.
- `appId`, `appName`, `appStore`: the promoted app for app-install ads.
- `targetDomain`: the advertised domain when Google provides it (domain searches) or it's in the ad's display URL.
- `region` / `platform`: the filters the ad was found with.
- `contentError`: only present if the ad's preview couldn't be downloaded; the ad is still returned.

**Advertiser search** mode returns one item per matching advertiser: `query`, `advertiserId`, `advertiserName`, `country` (where the advertiser is based), `adCountMin`/`adCountMax` (Google's rounded ad count) and `advertiserUrl`.

## How much does it cost to scrape the Google Ads Transparency Center?

Pay-per-event:

| Event                                  | Price       |
| -------------------------------------- | ----------- |
| Ad (one ad with its content)           | **$0.0018** |
| Advertiser (advertiser search results) | **$0.0018** |

That's **$1.80 per 1,000 ads**, including preview download and parsing. The default input (20 Nike ads) costs about $0.04. Failed lookups and unknown advertisers are free. If you set a **maximum cost per run**, the actor stops cleanly when it's reached.

## What are the limits of Google Ads Transparency data? (read before buying)

- **Many text ads are screenshots.** The Transparency Center stores a lot of search text ads, especially older or long-running ones, as archived images. For those you get `imageUrl` (the screenshot) but no `headline`/`description`. Ads Google serves as HTML previews get full text.
- **Video:** the YouTube `videoId` is returned when the preview references it. Some video ads only have a thumbnail or a rendered template (then you get images and text, not the video ID).
- **No impression or spend data.** Google publishes these only for political ads, which this actor doesn't cover.
- **Regions and platforms per ad:** Google's creative search doesn't list every country or platform an ad ran on. `region` and `platform` echo your filters. To know if an ad ran on YouTube, filter by `platform: "YOUTUBE"`.
- **Verification status:** the endpoints this actor uses don't return an advertiser's verification badge, so it isn't in the output.
- **Ad counts** (`adCountMin`/`adCountMax`) and totals are Google's rounded ranges, as on the website.
- **Ordering:** Google returns the most recently shown ads first. Date filters apply to when the ad was shown.
- **Rate limits:** Google throttles single IPs after bursts of requests. The actor backs off, and switches to a fresh Apify datacenter proxy IP when blocked. Very large runs (thousands of ads) may slow down.

## Tips for scraping the Google Ads Transparency Center

- **Competitor monitoring:** schedule a daily run with `onlyNew: true` (see below) and send new ads to Slack, Google Sheets or a webhook with Apify integrations.
- **Long-running winners:** sort by `totalDaysShown`. Ads that run for months are usually the ones that convert.
- **Brand protection:** search your own domain with an empty region to see everyone advertising it worldwide.
- **Multiple accounts:** big brands run several advertiser accounts (per country or agency). Run **Advertiser search** first, then pass the AR IDs you want.
- **Just the list:** turn off `includeAdContent` for a fast inventory of creative IDs, formats and dates.

## How do I monitor the Google Ads Transparency Center for new items?

Turn on `onlyNew` and run the actor on an [Apify schedule](https://docs.apify.com/platform/schedules) (e.g. daily; save the input as a task and schedule the task).

- The first run is a baseline and returns ads as usual. Later runs return, and charge for, only ads (by `creativeId`) not returned before. In advertiser search mode, only new advertisers (by `advertiserId`). Skipped items are never charged, and their previews are not downloaded.
- `maxAdsPerAdvertiser` counts only new ads. Paging stops after two pages with nothing new.
- State lives in your account in the key-value store `google-ads-transparency-state`, one record per combination of mode, advertisers, region, formats and platform (not dates, so relative `dateFrom` works). Changing any of these starts a new baseline. It remembers the latest 50,000 items.
- Add a Slack, email or webhook integration to the task to get alerts.

## Google Ads Transparency scraper FAQ

**Is this the official Google Ads API?** No. Google has no public API for the Transparency Center. This actor reads the same public data the website shows.

**Do I need a proxy?** Usually not. The actor connects directly, and only if Google starts rate-limiting does it switch to Apify's datacenter proxy (included in all Apify plans). You can also set your own proxy. Residential proxies aren't required.

**Why did a name match the wrong advertiser?** Several advertisers can share a name. The actor takes an exact match with the most ads. Check the run log, or use Advertiser search mode and pass the AR ID.

**Can I scrape a single ad?** Paste the ad's Transparency Center URL. The actor scrapes that ad's advertiser; filter or search the output by `creativeId`.

**Can I use it with AI agents?** Yes. Call it through the Apify API, the Apify MCP server or any integration. Pricing is per event only, so agent payments work too.

**Disclaimer:** This actor is not affiliated with, endorsed by or sponsored by Google. Google Ads is a trademark of Google LLC. It only collects data Google publishes publicly in the Ads Transparency Center. You are responsible for complying with applicable terms and laws when using the data.

## Related actors

- [google-trends](https://apify.com/cprussin/google-trends?fpr=to54nm): Google Trends interest over time, regions, related queries and trending searches.
- [product-hunt-launches](https://apify.com/cprussin/product-hunt-launches?fpr=to54nm): Product Hunt launches, leaderboards, upvotes and makers.
- [trustpilot-reviews](https://apify.com/cprussin/trustpilot-reviews?fpr=to54nm): Trustpilot reviews, ratings and TrustScore for any company.
