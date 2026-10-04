# Bilibili Scraper: Videos, Comments, Trending & Search

**Bilibili Scraper** pulls public data from **Bilibili (哔哩哔哩, B站)**, China's largest video platform for anime, gaming, tech, knowledge and youth culture. Get **trending videos**, **keyword search results**, **channel (UP主) uploads** or **specific video URLs**, each with full stats: views, likes, coins, favorites, shares, danmaku (bullet comments) count, comment count, tags, category, duration, cover and author. Optionally add each video's **top comments with replies**.

- ✅ **Four sources:** trending (热门), keyword search (sort by relevance, views, newest, danmaku or favorites), channel uploads by UID, URL or name, and any list of video URLs / BV ids / av ids.
- ✅ **Full engagement stats** from Bilibili's own video endpoint, including Bilibili-specific signals: **coins (投币)**, **favorites (收藏)** and **danmaku (弹幕)**.
- ✅ **Tags and category** on every video, for topic and trend analysis.
- ✅ **Top comments** with author, likes, date and reply count, threaded (each reply points to its parent).
- ✅ No login, no cookies, no API key. No proxy needed at normal volumes.
- ✅ Pay only per video and per comment returned. Failed or missing videos are never charged.

## Who uses Bilibili video data?

- **Brand, marketing and agency teams** entering China track how a product, game or brand is discussed on Bilibili, and which creators (UP主) drive views.
- **Game studios and publishers** monitor trending gameplay videos, player sentiment in comments, and creator coverage after a launch or update.
- **Influencer marketing:** shortlist Bilibili creators by recent uploads and engagement (likes, coins, favorites per view).
- **Market and academic researchers** study Chinese internet culture, trending topics and audience reactions.
- **Data and AI teams** build Chinese-language datasets of video titles, descriptions, tags and comments for NLP, sentiment analysis or LLM summaries.
- **Media monitoring:** schedule a daily trending or keyword run and pipe results to Google Sheets, Slack or a webhook with Apify integrations.

## How does the Bilibili scraper work?

1. Pick a **mode**:
   - `trending`: Bilibili's current popular videos (the 热门 page).
   - `search`: one search per keyword. Chinese keywords give the best results (e.g. `原神`, `人工智能`), English works too.
   - `videos`: video URLs (`https://www.bilibili.com/video/BV1xx411c7mD`), BV ids (`BV1xx411c7mD`) or av ids (`av170001`).
   - `user`: channels by UID (`546195`), URL (`https://space.bilibili.com/546195`) or exact name (`老番茄`). Uploads come newest first.
2. Set **max videos** (per keyword, per channel or for trending) and whether to **include comments**.
3. The actor opens a guest session like a browser (cookies + Bilibili's WBI request signing), lists the videos, then fetches each video's details and tags (and comments if enabled). Requests are sequential with small random pauses.
4. If Bilibili's risk control (风控, HTTP 412 / code -352) kicks in, the actor backs off, starts a fresh session and retries, and slows down for the rest of the run. Missing or deleted videos are logged and skipped. A run that ends with **zero videos fails** instead of reporting success.

## How do I choose which Bilibili videos to scrape?

| Field                 | Description                                                                | Example                                 |
| --------------------- | -------------------------------------------------------------------------- | --------------------------------------- |
| `mode`                | `trending`, `search`, `videos` or `user`                                   | `"search"`                              |
| `keywords`            | Search keywords (mode `search`)                                            | `["原神", "黑神话 悟空"]`               |
| `searchOrder`         | `relevance`, `views`, `newest`, `danmaku` or `favorites`                   | `"newest"`                              |
| `videos`              | Video URLs, BV ids or av ids (mode `videos`)                               | `["BV1xx411c7mD"]`                      |
| `userIds`             | Channel UIDs, space.bilibili.com URLs or names (mode `user`)               | `["https://space.bilibili.com/546195"]` |
| `maxItems`            | Max videos per keyword / per channel / for trending                        | `50`                                    |
| `includeComments`     | Add top comments to each video                                             | `true`                                  |
| `maxCommentsPerVideo` | Max comments per video                                                     | `20`                                    |
| `onlyNew`             | Monitoring: only videos not returned by an earlier run with the same input | `true`                                  |
| `proxyConfiguration`  | Optional Apify Proxy, only if Bilibili blocks requests from your account   | `{ "useApifyProxy": true }`             |

Example: the 100 newest videos for two keywords, without comments.

```json
{
  "mode": "search",
  "keywords": ["原神", "崩坏：星穹铁道"],
  "searchOrder": "newest",
  "maxItems": 100,
  "includeComments": false
}
```

## What data do you get for each Bilibili video?

One dataset item per video (shortened):

```json
{
  "bvid": "BV1LiaJ6AEhx",
  "aid": 117353438381842,
  "title": "吹哨的代价：为什么发现问题的人，最后先成了问题？",
  "description": "见过全员在场的“合法谋杀”吗？…",
  "url": "https://www.bilibili.com/video/BV1LiaJ6AEhx",
  "author": { "mid": "1208823126", "name": "大圆镜科普" },
  "publishDate": "2026-09-29T09:00:00.000Z",
  "durationSec": 476,
  "views": 478970,
  "likes": 45463,
  "coins": 3337,
  "favorites": 10738,
  "shares": 1121,
  "danmaku": 947,
  "replies": 1963,
  "tags": ["社会心理学", "组织沉默", "吹哨人"],
  "cover": "https://i1.hdslb.com/bfs/archive/33f7ddb4f23818b7e08baaec98690040c8128de6.jpg",
  "category": "科学科普",
  "categoryId": 201,
  "parts": 1,
  "source": "trending",
  "scrapedAt": "2026-09-30T09:14:04.043Z",
  "comments": [
    {
      "rpid": "318994201744",
      "parentRpid": null,
      "text": "如果上级决定有误，你会站出来做吹哨人吗？",
      "author": { "mid": "1208823126", "name": "大圆镜科普" },
      "likes": 2274,
      "date": "2026-09-29T09:01:47.000Z",
      "replyCount": 200
    },
    {
      "rpid": "315435069665",
      "parentRpid": "318994201744",
      "text": "会。",
      "author": { "mid": "2328353", "name": "答题算错怎么办" },
      "likes": 29,
      "date": "2026-09-29T09:02:16.000Z",
      "replyCount": 0
    }
  ]
}
```

**Field notes**

- `views`, `likes`, `coins`, `favorites`, `shares`, `danmaku` and `replies` are Bilibili's live counters when the video was scraped. `replies` is the video's total comment count; `comments` holds the ones scraped.
- `author.mid` is the channel UID; the channel page is `https://space.bilibili.com/<mid>`.
- `publishDate`, `date` and `scrapedAt` are ISO 8601 UTC.
- `category` is Bilibili's category (分区) name when the listing provides it (trending and search); `categoryId` is always set. In `videos` and `user` modes `category` may be `null`.
- `parts` is the number of parts (分P) in a multi-part video.
- `comments` is only present when **Include comments** is on. Top-level comments have `parentRpid: null`; replies carry the `rpid` of the comment they belong to.
- `source` says how the video was found: `trending`, `search:<keyword>`, `user:<UID>` or `video`.
- Text is returned exactly as posted, usually in Chinese.

## How much does it cost to scrape Bilibili?

Pay-per-event, only for what you get:

| Event                                  | Price      |
| -------------------------------------- | ---------- |
| Video (one dataset item)               | **$0.005** |
| Comment (only with "Include comments") | **$0.002** |

Example: 100 videos without comments = **$0.50**. 100 videos with 10 comments each = $0.50 + $2.00 = **$2.50**. Missing, deleted and duplicate videos are not charged. If you set a **maximum cost per run**, the actor stops cleanly when it reaches it.

## What are the limits of scraping Bilibili? (please read)

- **Comments are limited to what Bilibili shows logged-out visitors.** Without login, Bilibili returns only the first page of hot comments: about **3 top-level comments plus up to 20 replies to each** (roughly 60 per video). This actor does not log in, so `maxCommentsPerVideo` above ~60 has no effect. It is not a full comment-thread downloader.
- **Search** returns at most 50 pages (about 1,000 videos) per keyword, a limit set by Bilibili.
- **Speed:** about 1–2 videos per second, slower with comments. Requests are deliberately sequential to stay under Bilibili's risk control.
- **Risk control:** Bilibili sometimes blocks requests from cloud servers for a while (HTTP 412). The actor retries with fresh sessions and falls back to a second endpoint for channel uploads. If a keyword or channel still fails, the run continues with the others and the log says which failed. If every source fails, the run fails, so you are never charged for an empty result.
- Region-locked, deleted, private or paid-only videos are skipped.
- No video/audio downloads, subtitles or danmaku text.

## How do I monitor Bilibili for new items?

Turn on `onlyNew` and run the actor on an [Apify schedule](https://docs.apify.com/platform/schedules) (e.g. daily; save the input as a task and schedule the task).

- The first run is a baseline and returns videos as usual. Later runs return, and charge for, only videos (by `bvid`) not returned before. Skipped videos are never charged, and their details and comments are not fetched.
- Best fits: new uploads from channels (mode `user`), new videos for a keyword (`searchOrder: "newest"`), or videos newly on trending. Newest-first lists stop after 3 known videos in a row, so older videos the baseline did not reach are not returned as new.
- State lives in your account in the key-value store `bilibili-scraper-state`, one record per combination of mode, keywords, search order, videos and channels. Changing any of these starts a new baseline. It remembers the latest 50,000 videos.
- Add a Slack, email or webhook integration to the task to get alerts.

## Bilibili scraper FAQ

**Do I need a Bilibili account, cookies or an API key?** No. The actor uses Bilibili's public web API the same way a logged-out browser does.

**Can I scrape a channel by name?** Yes. Put the exact channel name in `userIds`. If there is no exact match, the top search result is used and the log says so. UIDs are the most reliable.

**Why are titles and comments in Chinese?** Bilibili is a Chinese platform; the actor returns text as posted. Translate afterwards if needed (e.g. with an LLM).

**Can I use it through the API or with AI agents?** Yes. Call it through the Apify API, the Apify MCP server or any Apify integration.

**Is scraping Bilibili legal?** The actor only collects publicly visible data. Comments and channel names are user content, so you are responsible for how you store and use them (e.g. PIPL/GDPR) and for complying with Bilibili's terms.

**Disclaimer:** This actor is not affiliated with, endorsed by or sponsored by Bilibili Inc. Bilibili and 哔哩哔哩 are trademarks of their respective owners.

## Related actors

- [youtube-transcripts](https://apify.com/cprussin/youtube-transcripts?fpr=to54nm): Captions and transcripts from YouTube videos and channels.
- [telegram-channel-scraper](https://apify.com/cprussin/telegram-channel-scraper?fpr=to54nm): Posts, views and reactions from public Telegram channels.
- [substack-scraper](https://apify.com/cprussin/substack-scraper?fpr=to54nm): Substack newsletter posts, content and public stats.
