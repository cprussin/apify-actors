# Telegram Channel Scraper - Posts, Views & Reactions

**Telegram Channel Scraper** exports posts from **public Telegram channels** to JSON, CSV or Excel: full text, date, **view count**, **emoji reactions**, photos and videos, links, hashtags, forwards and replies, plus each channel's **title, description and exact subscriber count**. It reads Telegram's public web preview (`t.me/s/<channel>`), so it needs **no login, no phone number, no API key and no Telegram account**.

- ✅ **No login.** Nothing to set up and no account at risk of a ban.
- ✅ **Engagement data:** views, every reaction with its count (including paid Star reactions), edited flag and author signature.
- ✅ **Media:** photo URLs, video URLs with thumbnails and durations, albums, audio, documents, link previews.
- ✅ **Context:** "forwarded from" (channel + original post), replies (quoted post + text), outbound links and hashtags.
- ✅ **Channel info:** title, description, exact subscriber count, profile photo, verified badge, photo/video/link counters.
- ✅ **Incremental runs.** Set `sinceDate` (e.g. `"24 hours"`) and the run stops at older posts, so scheduled runs only pay for new posts.
- ✅ **Pay per result, no start fee.** Missing, private or disabled channels cost nothing.

## Who uses Telegram channel data?

- **Brand and media monitoring**: track what news, crypto, finance or industry channels post, and how many people see it.
- **Market and crypto research**: collect signals, announcements and sentiment from project and trading channels.
- **Journalists and OSINT researchers**: archive public channel posts with permalinks and timestamps.
- **Marketers and agencies**: benchmark competitors' channels by views, reactions and posting frequency; vet channels before buying ads.
- **Data scientists and AI teams**: build datasets for sentiment analysis, topic modeling, translation or LLM summarization.

## How does the Telegram channel scraper work?

1. Add channels as usernames or links. All of these work: `durov`, `@durov`, `https://t.me/durov`, `https://t.me/s/durov`, `https://t.me/durov/528`.
2. The actor opens each channel's public web preview and pages backwards through its history (`?before=<post id>`), newest post first.
3. Each post is parsed into one clean dataset item. Requests are retried with backoff, rate limits (HTTP 429) are respected, and duplicates are removed.
4. Channels that can't be read (don't exist, are groups/users/bots, or have the web preview disabled) produce one **free** error item explaining why. The rest of the run continues.

## How do I choose which Telegram channels to scrape?

| Field                | Description                                                                                           | Example                          |
| -------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------- |
| `channels`           | Public channel usernames or t.me links                                                                | `["durov", "https://t.me/tass"]` |
| `maxPostsPerChannel` | Stop after this many posts per channel (newest first)                                                 | `500`                            |
| `sinceDate`          | Only posts on or after this date: `YYYY-MM-DD`, ISO timestamp, or relative (`"24 hours"`, `"7 days"`) | `"7 days"`                       |
| `includeChannelInfo` | Add one channel-profile item per channel (default `true`)                                             | `true`                           |
| `onlyNew`            | Monitoring: only posts not returned by an earlier run with the same channels                          | `true`                           |
| `proxyConfiguration` | Optional Apify Proxy for very large runs                                                              | `{ "useApifyProxy": true }`      |

Example: every post from the last week from three channels, with channel stats.

```json
{
  "channels": ["durov", "https://t.me/telegram", "@nytimes"],
  "sinceDate": "7 days",
  "maxPostsPerChannel": 1000,
  "includeChannelInfo": true
}
```

## What data do you get for each Telegram post?

Every item has a `type`: `post`, `channel` or `error`. The **Posts** and **Channels** tabs in the Output view show them as tables.

Post:

```json
{
  "type": "post",
  "channel": "durov_russia",
  "postId": 63,
  "date": "2025-11-22T17:22:48.000Z",
  "edited": false,
  "author": null,
  "text": "Папаха никогда не была просто шапкой. Это про то, откуда ты родом, про уважение и дисциплину. …",
  "views": 3260000,
  "reactions": [
    {
      "emoji": null,
      "customEmojiId": "5305565863728918192",
      "paid": false,
      "count": 32800
    },
    { "emoji": "🫡", "customEmojiId": null, "paid": false, "count": 9750 },
    { "emoji": "🏆", "customEmojiId": null, "paid": false, "count": 5440 }
  ],
  "media": [
    {
      "type": "video",
      "url": "https://cdn4.telesco.pe/file/a0973c48eb.mp4?token=…",
      "thumbnailUrl": "https://cdn4.telesco.pe/file/Xo1so….jpg",
      "duration": "0:56",
      "title": null
    }
  ],
  "linkPreview": null,
  "forwardedFrom": {
    "name": "Khabib Nurmagomedov",
    "url": "https://t.me/khabib_nurmagomedov/127",
    "channel": "khabib_nurmagomedov",
    "postId": 127
  },
  "replyTo": null,
  "links": [],
  "hashtags": [],
  "permalink": "https://t.me/durov_russia/63"
}
```

Channel info:

```json
{
  "type": "channel",
  "channel": "durov",
  "title": "Pavel Durov",
  "description": "Founder of Telegram.",
  "subscribers": 10579568,
  "photoUrl": "https://cdn4.telesco.pe/file/….jpg",
  "verified": true,
  "counters": { "photos": 102, "videos": 46, "links": 200 },
  "url": "https://t.me/durov"
}
```

Error (not charged):

```json
{
  "type": "error",
  "channel": "wallstreetbets",
  "errorCode": "notAChannel",
  "error": "@wallstreetbets is a group, not a channel. Only public channel posts can be scraped."
}
```

**Field notes**

- `date` is an ISO 8601 UTC timestamp. `postId` is the channel's message number; `permalink` opens the post in Telegram.
- `views` and reaction `count`s are what Telegram shows, so large numbers are rounded (`18.9M` becomes `18900000`). `subscribers` on the channel item is exact.
- `reactions`: standard reactions have an `emoji`. Custom (premium) emoji reactions only expose a `customEmojiId`. Paid Telegram Stars reactions have `paid: true`.
- `media[].type` is one of `photo`, `video`, `roundVideo`, `voice`, `audio`, `document`, `sticker`, `poll`, `location`. Photo and video URLs point to Telegram's CDN and **expire after a while**; download them soon if you need the files. Documents and audio link to the post, because the preview doesn't expose the file.
- `author` is the post signature, when the channel enables signatures.
- `text` is plain text with line breaks. Custom emoji appear as their standard fallback emoji.
- `errorCode`: `notFound`, `previewDisabled`, `notAChannel`, `invalidInput` or `failed`.

## How much does it cost to scrape Telegram channels?

Pay-per-event, only for what you get. No start fee.

| Event                                      | Price      |
| ------------------------------------------ | ---------- |
| Post (one post in the dataset)             | **$0.002** |
| Channel info (one per channel, if enabled) | **$0.001** |

That's **$2 per 1,000 posts**. Error items, duplicates and posts filtered out by `sinceDate` are free. If you set a **maximum cost per run**, the actor stops cleanly when it reaches it.

## Tips for scraping Telegram channels

- **Daily monitoring:** schedule the actor with `onlyNew: true` (see below) and send new posts to Google Sheets, Slack, email or a webhook with Apify integrations.
- **Full history:** leave `sinceDate` empty and raise `maxPostsPerChannel`. The preview goes back to the channel's first post.
- **Only stats:** set `maxPostsPerChannel: 1` with `includeChannelInfo: true` to get subscriber counts for a list of channels cheaply.
- Very large runs (many thousands of pages) may hit Telegram rate limits. The actor backs off automatically; add Apify Proxy if it keeps happening.

## What are the limits of scraping Telegram?

- **Public channels only.** The actor reads what anyone can see at `t.me/s/<channel>` without logging in. It **cannot** read private channels, invite-only links (`t.me/+…`), groups, direct messages, or comments.
- Some channel owners disable the web preview. Those channels return a `previewDisabled` error item (free).
- Comments/discussion threads, poll results and exact view counts aren't available in the web preview.

## How do I monitor Telegram channels for new items?

Turn on `onlyNew` and run the actor on an [Apify schedule](https://docs.apify.com/platform/schedules) (e.g. hourly or daily; save the input as a task and schedule the task).

- The first run is a baseline and returns posts as usual. Later runs return, and charge for, only posts (by channel and `postId`) not returned before. Skipped posts are never charged.
- Each channel is read newest first and stops after 3 known posts in a row, so a quiet channel costs one page request. Unlike `sinceDate`, nothing is missed or repeated if a run is late or early.
- Turn off `includeChannelInfo` if you don't need a fresh profile item (charged) on every run.
- State lives in your account in the key-value store `telegram-channel-scraper-state`, one record per channel list. Changing it starts a new baseline. It remembers the latest 50,000 posts.
- Add a Slack, email or webhook integration to the task to get alerts.

## Telegram channel scraper FAQ

**Do I need a Telegram account, API ID or phone number?** No. The actor uses Telegram's public web preview, the same page you see when you open `https://t.me/s/durov` in a browser.

**Can it scrape private channels or groups?** No, and it never will. Only public channels with the web preview enabled are supported.

**How far back can it go?** Usually to the channel's first post. `maxPostsPerChannel` and `sinceDate` let you limit it.

**Can I use it through the API or with AI agents?** Yes. Call it through the Apify API, the Apify MCP server or any Apify integration. Pricing is per event only, so it works well with agent payments.

**Is scraping Telegram legal?** The actor only collects content that channel owners publish publicly on the web. Posts can still contain personal data, so you are responsible for how you store and use it (e.g. GDPR/CCPA), for respecting [Telegram's Terms of Service](https://telegram.org/tos) and copyright, and for not using the data for spam, harassment or surveillance of individuals.

**Disclaimer:** This actor is not affiliated with, endorsed by or sponsored by Telegram. Telegram is a trademark of Telegram FZ-LLC.

## Related actors

- [substack-scraper](https://apify.com/cprussin/substack-scraper?fpr=to54nm): Substack newsletter posts, content and public stats.
- [youtube-transcripts](https://apify.com/cprussin/youtube-transcripts?fpr=to54nm): Captions and transcripts from YouTube videos and channels.
- [bilibili-scraper](https://apify.com/cprussin/bilibili-scraper?fpr=to54nm): Bilibili videos, comments, trending and search results.
