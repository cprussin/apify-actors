# Douyin Hot Search & China Trending Topics: Baidu, Toutiao, Bilibili

**China Hot Search** collects the trending boards of China's biggest apps in one run and returns them as JSON, CSV or Excel:

- ✅ **Douyin hot search (抖音热榜)**: the ~50 keywords on Douyin's hot list, with hot value and badges such as 新 (new), 热 (hot), 爆 (explosive), 首发 (first release), 独家 (exclusive) and 辟谣 (debunk).
- ✅ **Baidu realtime hot search (百度热搜)**: ~50 trending searches with hot score, 新/热 badge and a short summary.
- ✅ **Toutiao hot board (头条热榜)**: ~50 news events with heat, badge and topic categories.
- ✅ **Bilibili hot search words (B站热搜)**: the top 10 search words with heat score.
- ✅ One clean row per trend: `platform`, `rank`, `title`, `hotValue`, `label` (Chinese) + `labelEn` (English), `url`, `fetchedAt`.
- ✅ **No login, no cookies to paste, no proxy**: plain HTTP to the platforms' public board endpoints, about 5 requests per run, and it respects robots.txt.
- ✅ **Robust**: if one board is down, the others still deliver; the failure is logged and that board is simply missing from the dataset.

**No personal data.** Boards hold keywords and headlines only: no user names, comments or profiles.

## Start in one minute

Click **Start** with the prefilled input:

```json
{
  "platforms": ["douyin", "baidu", "toutiao", "bilibili"]
}
```

You get: about 160 rows, the full Douyin, Baidu and Toutiao boards (~50 each) and the Bilibili top 10, ranked, with hot values, badges and links.

**Cost:** about $0.64: 160 trends × $0.004, plus the $0.00005 actor-start fee.

## Use with an AI assistant

Connect the [Apify MCP server](https://mcp.apify.com) to Claude, ChatGPT, Cursor or any MCP client (`https://mcp.apify.com?tools=cprussin/china-hot-search` loads only this actor), then paste:

```text
Use the Apify actor cprussin/china-hot-search to get the top 10 of the Douyin, Baidu and Toutiao hot-search boards. Translate each keyword to English and group the topics that appear on more than one board.
```

## Recipes

### Douyin hot search only

```json
{
  "platforms": ["douyin"]
}
```

### Top 10 of every board for a daily digest

Schedule this every morning (Apify **Schedules**) and send the dataset to Slack, email or Google Sheets.

```json
{
  "platforms": ["douyin", "baidu", "toutiao", "bilibili"],
  "maxItemsPerPlatform": 10
}
```

### News boards: Baidu and Toutiao

```json
{
  "platforms": ["baidu", "toutiao"]
}
```

### Youth and gaming trends: Douyin and Bilibili top 20

```json
{
  "platforms": ["douyin", "bilibili"],
  "maxItemsPerPlatform": 20
}
```

## Who uses China trending data?

- **Brands and marketing agencies selling into China**: see what Douyin and Bilibili users are searching right now, and time content or ads to it.
- **Media monitoring and PR teams**: track when a brand, product or crisis reaches Baidu or Toutiao's hot list, and how high.
- **Researchers and journalists**: build a time series of China's public attention by running the actor on a schedule.
- **Traders and analysts**: spot consumer, policy and market stories as they start trending.
- **AI agents**: give an LLM a live view of what China is talking about through the Apify API or MCP server.

## How does it work?

1. Pick the boards (all four by default).
2. The actor reads each host's `robots.txt`, then loads the board's public JSON endpoint:
   - Douyin: `iesdouyin.com` billboard API; if it fails, the `douyin.com` web board (after one home page visit for cookies), which adds `videoCount` and `eventTime`.
   - Baidu: `top.baidu.com` realtime board.
   - Toutiao: `toutiao.com` hot board.
   - Bilibili: `s.search.bilibili.com` hot words.
3. Each row is written to the dataset as soon as its board is parsed. Pinned editorial items (置顶) are skipped, so `rank` 1 is the top trending row.

A run takes about 10–30 seconds.

## Input

| Field                 | Description                                                         | Example                 |
| --------------------- | ------------------------------------------------------------------- | ----------------------- |
| `platforms`           | Boards: `douyin`, `baidu`, `toutiao`, `bilibili` (empty = all four) | `["douyin", "toutiao"]` |
| `maxItemsPerPlatform` | Keep the top N rows of each board, 0–100 (default 0 = every row)    | `10`                    |

## What data do you get for each trend?

```json
{
  "platform": "douyin",
  "platformName": "Douyin (抖音)",
  "board": "抖音热榜",
  "rank": 2,
  "title": "英雄联盟S16瑞士轮首日赛程",
  "hotValue": 11745718,
  "label": "热",
  "labelEn": "hot",
  "url": "https://www.douyin.com/search/%E8%8B%B1%E9%9B%84%E8%81%94%E7%9B%9FS16%E7%91%9E%E5%A3%AB%E8%BD%AE%E9%A6%96%E6%97%A5%E8%B5%9B%E7%A8%8B",
  "description": null,
  "categories": [],
  "videoCount": null,
  "eventTime": null,
  "fetchedAt": "2026-10-20T06:17:12.000Z"
}
```

- `title` is the keyword or headline as shown, in Chinese.
- `hotValue` is the platform's own heat score (热度). Scales differ: compare ranks across platforms, hot values only within one.
- `label` / `labelEn`: 新 new, 热 hot, 爆 explosive, 首发 first release, 独家 exclusive, 辟谣 debunk, 同城 local, 挑战 challenge, 热议 hot debate, 商 sponsored, ... `null` when the row has no badge.
- `url`: the keyword's search page (Douyin, Baidu, Bilibili) or the event's topic page (Toutiao, and Douyin when the web board is used).
- `description` (Baidu), `categories` (Toutiao, in English) and `videoCount` / `eventTime` (Douyin web board) are filled where the platform provides them.

## How much does it cost to scrape Douyin hot search?

Pay-per-event:

| Event | Price      | When                           |
| ----- | ---------- | ------------------------------ |
| Trend | **$0.004** | One row written to the dataset |

That's **$4 per 1,000 trends**, and no extra start fee beyond Apify's $0.00005. A full run of all four boards (~160 rows) costs about $0.64; the Douyin board alone (~50 rows) about $0.20; a top-10 digest of all four boards $0.16. If you set a **maximum cost per run**, the actor stops cleanly when it reaches it.

## Tips

- **Track changes over time**: schedule the actor hourly or daily and compare `rank` and `hotValue` per `title` between runs.
- **Translate in your pipeline**: titles are Chinese; pipe them through a translation step or ask your AI assistant to translate them.
- **Boards update every few minutes**, so two runs a few minutes apart can differ.

## FAQ

**Do I need a Douyin, Baidu or Bilibili account?** No. The boards are public and the actor sends no login.

**Why is Weibo not included?** Weibo's robots.txt disallows all crawlers and its hot-search endpoint needs a login, so it's left out on purpose.

**What if a board fails?** The other boards still run. The failed board is logged and named in the run's status message, and you aren't charged for rows you didn't get.

**Does it respect robots.txt?** Yes. Each host's robots.txt is read first, and a board whose endpoint is disallowed is skipped.

**Can I use it through the API or with AI agents?** Yes. Call it through the Apify API, the Apify MCP server or any Apify integration.

**Disclaimer:** This actor is not affiliated with Douyin, ByteDance, Baidu, Toutiao or Bilibili. Names and trademarks belong to their owners. You are responsible for complying with applicable laws and the platforms' terms when using the data.

## Related actors

- [bilibili-scraper](https://apify.com/cprussin/bilibili-scraper?fpr=to54nm): Bilibili trending, search and channel videos with views, likes, danmaku and comments.
- [google-trends](https://apify.com/cprussin/google-trends?fpr=to54nm): Google Trends interest over time, by region, related queries and trending searches.
