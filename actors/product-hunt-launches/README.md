# Product Hunt Scraper: launches, leaderboards, upvotes and makers

**Product Hunt Scraper** exports Product Hunt launches as clean JSON, CSV or Excel: **name, tagline, live upvote count, Product of the Day rank, topics, website, hunter and makers**, plus descriptions, media and comments when you add a free Product Hunt API token. Use it to track new launches every day, pull a topic's newest products, or export past daily, weekly and monthly leaderboards.

- ✅ **Works without an API key.** Current launches and topic feeds, with live upvote counts and top-5 daily ranks, need no login or token.
- ✅ **Historical leaderboards** by day, week or month for any date range, with every launch's rank. Needs a free Product Hunt developer token.
- ✅ **Topics / categories:** AI, developer tools, productivity, SaaS, marketing and more.
- ✅ **Specific launches by URL**, with makers, topics, media and the top comments.
- ✅ **Keyword filter:** keep only launches that mention "CRM", "agents" or any other words. Filtered-out launches are free.
- ✅ **Pay per launch:** $1 per 1,000 launches. No monthly rental.
- ✅ **Fast and light:** plain HTTP, no browser, no proxy. The default run finishes in a few seconds.

## What can you do with Product Hunt launch data?

- **Market research and trend spotting:** see what launches every day in your category and which products win Product of the Day.
- **Lead generation:** build lists of newly launched startups, their websites and makers for sales, partnerships or agency outreach.
- **Investors and scouts:** screen new products by upvotes, rank and topic; export a month's leaderboard for deal flow.
- **Competitor monitoring:** schedule a daily run with keywords and get new competitors in Slack, Sheets or your CRM.
- **Content and newsletters:** "top launches of the week" posts, roundups and datasets for AI agents.

## How does the Product Hunt scraper work?

Product Hunt protects www.producthunt.com with a Cloudflare browser challenge, which blocks most scrapers on datacenter IPs. This actor uses three sources that are open to automated access:

1. **No token (default):** Product Hunt's public Atom feed of current featured launches (overall or per topic), plus Product Hunt's public embed badges for each launch's **live upvote count** and **top-5 daily / weekly / monthly rank**.
2. **With a free API token:** the official [Product Hunt API v2](https://api.producthunt.com/v2/docs) for historical leaderboards, specific URLs, descriptions, topics, media, makers and comments. It pages through results, waits out Product Hunt's rate limit, and removes duplicates.
3. **Website URLs:** each launch's Product Hunt redirect link is followed to get the product's real website (best effort; see Limitations).

### Get a free Product Hunt API token (2 minutes)

1. Log in to Product Hunt and open [API dashboard → Applications](https://www.producthunt.com/v2/oauth/applications).
2. Click **Add an application**. Any name works; use `https://localhost` as the redirect URI.
3. Click **Create Token** under "Developer Token" and paste the token into **Product Hunt API token**. It is stored as a secret input.

## What does each Product Hunt scraping mode return?

| Mode                                 | Token?   | Returns                                                                                                   |
| ------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------- |
| **Latest launches** (default)        | No       | Product Hunt's current featured launches (about 50), live upvotes, top-5 ranks                            |
| **Topics**                           | No       | Current launches in each topic (about 50 per topic)                                                       |
|                                      | Optional | With a token: every launch in the topic, newest first, optionally within a date range                     |
| **Leaderboard** (daily/weekly/month) | Optional | Without a token: current launches sorted by live upvotes. With a token: any past date range, fully ranked |
| **Specific launch URLs**             | Yes      | The full record for each URL                                                                              |

## How do I choose which Product Hunt launches to scrape?

| Field                  | Description                                                                       | Example                                           |
| ---------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| `mode`                 | `latest`, `topics`, `leaderboard` or `posts`                                      | `"leaderboard"`                                   |
| `topics`               | Topic slugs or URLs (Topics mode)                                                 | `["artificial-intelligence"]`                     |
| `period`               | `daily`, `weekly` (Monday–Sunday) or `monthly`, in Pacific Time like Product Hunt | `"daily"`                                         |
| `startDate`, `endDate` | Date range: `YYYY-MM-DD`, `today`, `yesterday` or `7 days`. Default: yesterday    | `"2026-09-01"`                                    |
| `postUrls`             | Launch URLs, slugs or IDs (Posts mode)                                            | `["https://www.producthunt.com/posts/notion-ai"]` |
| `searchKeywords`       | Keep launches mentioning any of these words (name, tagline, description, topics)  | `"crm, sales"`                                    |
| `maxItems`             | Max launches in total                                                             | `20`                                              |
| `maxPerGroup`          | Max launches per day/week/month or per topic, e.g. the top 10 of each day         | `10`                                              |
| `onlyNew`              | Monitoring: only launches not returned by an earlier run with the same input      | `true`                                            |
| `apiToken`             | Optional Product Hunt developer token                                             | `"..."`                                           |
| `includeMakers`        | Add makers (token)                                                                | `true`                                            |
| `includeComments`      | Add the most upvoted comments (token)                                             | `false`                                           |
| `maxCommentsPerLaunch` | Comments per launch                                                               | `20`                                              |
| `resolveWebsites`      | Resolve Product Hunt redirect links to real websites                              | `true`                                            |

Example: the top 10 launches of each day in September 2026.

```json
{
  "mode": "leaderboard",
  "period": "daily",
  "startDate": "2026-09-01",
  "endDate": "2026-09-30",
  "maxPerGroup": 10,
  "maxItems": 300,
  "apiToken": "YOUR_TOKEN"
}
```

Example, no token: today's AI and developer-tool launches mentioning "agent".

```json
{
  "mode": "topics",
  "topics": ["artificial-intelligence", "developer-tools"],
  "searchKeywords": "agent",
  "maxItems": 50
}
```

## What data do you get for each Product Hunt launch?

One dataset item per launch:

```json
{
  "id": "1252633",
  "name": "Acme Agents",
  "tagline": "AI agents that file your expense reports",
  "description": "Acme connects to your inbox and card feed...",
  "slug": "acme-agents",
  "url": "https://www.producthunt.com/posts/acme-agents",
  "website": "https://acme.example/",
  "websiteRedirectUrl": "https://www.producthunt.com/r/ABCDEF",
  "topics": ["Artificial Intelligence", "Fintech"],
  "votesCount": 293,
  "commentsCount": 41,
  "reviewsCount": 3,
  "reviewsRating": 5,
  "dailyRank": 1,
  "weeklyRank": null,
  "monthlyRank": null,
  "launchDate": "2026-09-17",
  "createdAt": "2026-09-16T18:44:42Z",
  "featuredAt": "2026-09-17T07:01:00Z",
  "featured": true,
  "thumbnail": "https://ph-files.imgix.net/....png",
  "media": [
    {
      "type": "image",
      "url": "https://ph-files.imgix.net/....png",
      "videoUrl": null
    }
  ],
  "hunter": {
    "id": "123",
    "name": "Jane Doe",
    "username": "janedoe",
    "headline": "Founder at Acme",
    "profileUrl": "https://www.producthunt.com/@janedoe",
    "twitterUsername": null,
    "websiteUrl": null,
    "avatarUrl": "https://ph-avatars.imgix.net/..."
  },
  "makers": [],
  "pricingType": null,
  "productLinks": [
    { "type": "website", "url": "https://www.producthunt.com/r/ABCDEF" }
  ],
  "comments": [
    {
      "id": "c1",
      "body": "Congrats on the launch!",
      "createdAt": "2026-09-17T08:00:00Z",
      "votesCount": 12,
      "parentId": null,
      "url": "https://www.producthunt.com/posts/acme-agents#comment-c1",
      "author": null
    }
  ],
  "source": "api",
  "scrapedAt": "2026-09-29T18:00:00.000Z"
}
```

(Illustrative record.)

**Field notes**

- `source` is `feed` (no token) or `api` (token). Without a token, `description`, `slug`, `commentsCount`, `launchDate`, `featuredAt`, `thumbnail`, `media` and `makers` are `null`/empty, `topics` holds the topic you asked for, and `hunter` has only a name.
- `votesCount` without a token is read live from Product Hunt's public badge for the launch.
- `dailyRank`, `weeklyRank`, `monthlyRank`: in leaderboard mode with a token, the launch's position in Product Hunt's ranking order for that period. Without a token, only top-5 "Product of the Day/Week/Month" ranks are known; others are `null`.
- `launchDate` is the Pacific-Time day the launch was featured (or created, if never featured).
- `makers`, `hunter` and comment `author`: Product Hunt hides names and usernames of most users from third-party API apps. Hidden fields are `null`, and fully hidden people are left out.
- `pricingType` is not exposed by the API or the feed and is always `null` for now.
- The dataset's **Overview** view shows the main columns. Export as JSON, CSV, Excel, XML or HTML, or use the Apify API.

## How much does it cost to scrape Product Hunt?

Pay per event:

| Event     | Price                   | When                                                  |
| --------- | ----------------------- | ----------------------------------------------------- |
| `launch`  | $0.001 ($1.00 / 1,000)  | Each launch saved to the dataset                      |
| `comment` | $0.0003 ($0.30 / 1,000) | Each comment included (only with Include comments on) |

- The default run (20 launches) costs $0.02.
- Apify's standard small actor-start fee applies. The actor stops cleanly at your run's maximum charge, and you are never billed for launches it didn't save. Launches removed by keyword filters or as duplicates are free.

## How do I monitor Product Hunt for new items?

Turn on `onlyNew` and run the actor on an [Apify schedule](https://docs.apify.com/platform/schedules) (e.g. daily or hourly; save the input as a task and schedule the task).

- The first run is a baseline and returns launches as usual. Later runs return, and charge for, only launches (by `id`) not returned before. Skipped launches are never charged, and their comments and websites are not fetched.
- Best fits: mode `latest` or `topics`, optionally with `searchKeywords` for competitor alerts. With a token, newest-first scans stop after 3 known launches in a row.
- State lives in your account in the key-value store `product-hunt-launches-state`, one record per combination of mode, period, topics, posts, keywords and featured filter (not dates). Changing any of these starts a new baseline. It remembers the latest 50,000 launches.
- Add a Slack, email or webhook integration to the task to get alerts.

## Product Hunt scraper FAQ

**Do I need a Product Hunt account?**
No, for current launches and topics. For historical leaderboards, specific URLs and comments you need a free developer token (steps above).

**Why not scrape the website directly?**
www.producthunt.com shows a Cloudflare "Just a moment..." challenge to most automated traffic, including headless browsers on cloud IPs. The public feed, badges and official API are stable and fast, so runs don't break when the site changes.

**How many launches can I get?**
Without a token, about 50 current launches per feed (overall or per topic). With a token, as many as the date range holds, up to 10,000 per run. Product Hunt's API has a rate limit; big runs pause until it resets.

**Is it legal to scrape Product Hunt?**
The actor reads public data and Product Hunt's official API. Personal data (names of makers and commenters) may be covered by laws such as GDPR, and Product Hunt's API terms apply to your token. You are responsible for lawful use.

**Can I use it with the API, Make, Zapier or an AI agent?**
Yes, like any Apify actor: Apify API, JavaScript/Python clients, Make, Zapier, n8n, or the Apify MCP server.

## What are the limits of scraping Product Hunt?

- **No emails.** Makers' emails aren't public and aren't returned.
- Without a token the actor sees only Product Hunt's current launches (the feed), not past days, and no descriptions, comments or makers.
- `website` is best effort: Product Hunt's redirect links sit behind the same Cloudflare check. If the check blocks the actor, `website` is `null` and `websiteRedirectUrl` still opens the site in a browser.
- Leaderboard ranks from the API follow Product Hunt's API ranking order, which can differ slightly from the website for launches with equal scores.
- Product Hunt can change its feed, badges or API at any time. The actor is tested daily; report problems on the Issues tab.

## Related actors

- [google-trends](https://apify.com/cprussin/google-trends): Google Trends interest over time, regions, related queries and trending searches.
- [google-ads-transparency](https://apify.com/cprussin/google-ads-transparency): Ads from the Google Ads Transparency Center by advertiser or domain.
- [app-store-reviews](https://apify.com/cprussin/app-store-reviews): App Store and Google Play reviews for any app.
