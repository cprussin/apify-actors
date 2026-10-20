# DeviantArt Metadata Scraper: Deviations, Galleries & Profiles

**DeviantArt Metadata Scraper** returns public metadata for **DeviantArt deviations and artist profiles**. Search by keyword, list a user's gallery (newest first), fetch profiles, or look up specific deviation URLs. For each deviation you get the title, author and their watcher count, publish time, views, favourites, comments, tags, license, mature, downloadable and **`noai`** flags, and a thumbnail URL.

**Metadata only.** The actor returns public metadata only and **never downloads images** or other files. It passes each deviation's **`noai`** flag through unchanged. No login or API key needed.

- ✅ **4 modes:** keyword search, user galleries, user profiles, deviation URLs.
- ✅ **Engagement stats:** views, favourites, comments, downloads, author watchers.
- ✅ **Rights flags:** license, `noai` (DeviantArt's "disallow AI use" flag), mature, downloadable, AI-generated.
- ✅ **Monitoring:** `sinceDate` returns only new deviations; gallery paging stops at the first older one.
- ✅ **Polite:** public, robots.txt-allowed pages only, 1 request per second (DeviantArt's `Crawl-delay`).
- ✅ Pay only per item returned.

## Start in one minute

Click **Start** with the prefilled input:

```json
{
  "mode": "search",
  "query": "dragon",
  "maxItems": 10,
  "proxyConfiguration": {
    "useApifyProxy": false
  }
}
```

You get: the 10 most relevant "dragon" deviations, each with `views`, `favourites`, `comments`, `author`, `authorWatchers`, `license`, `noai` and `thumbnailUrl`.

**Cost:** about $0.03: 10 deviations × $0.003, plus the $0.00005 actor-start fee.

## Use with an AI assistant

Connect the [Apify MCP server](https://mcp.apify.com) to Claude, ChatGPT, Cursor or any MCP client (`https://mcp.apify.com?tools=cprussin/deviantart-metadata` loads only this actor), then paste:

```text
Use the Apify actor cprussin/deviantart-metadata to get the 20 newest deviations in wlop's DeviantArt gallery and rank them by favourites.
```

## Recipes

### Monitor an artist's new uploads

Run on a schedule. Only deviations from the last 7 days are returned (and billed).

```json
{
  "mode": "userGallery",
  "usernames": ["wlop"],
  "maxItems": 100,
  "sinceDate": "7 days"
}
```

### Compare artist profiles

One profile item per user: watchers, watching, deviation count, pageviews, join date.

```json
{
  "mode": "userProfile",
  "usernames": ["wlop", "sandara", "88grzes"]
}
```

### Look up specific deviations (with tags)

```json
{
  "mode": "deviationUrls",
  "deviationUrls": ["https://www.deviantart.com/wlop/art/Nera2-1385671838"]
}
```

### Search with tags

Search and gallery pages don't list tags; `includeTags` looks them up (about 1 extra second per deviation).

```json
{
  "mode": "search",
  "query": "cyberpunk city",
  "maxItems": 25,
  "includeTags": true
}
```

## What data do you get for each item?

One dataset item per deviation or profile. Fields that don't apply are `null`. Example (a deviation, shortened):

```json
{
  "type": "deviation",
  "id": 1385671838,
  "url": "https://www.deviantart.com/wlop/art/Nera2-1385671838",
  "title": "Nera2",
  "author": "wlop",
  "authorUrl": "https://www.deviantart.com/wlop",
  "authorWatchers": 284253,
  "publishedAt": "2026-09-28T09:44:39.000Z",
  "views": 31616,
  "favourites": 467,
  "comments": 11,
  "downloads": 32,
  "tags": ["warrior"],
  "category": "image",
  "isMature": false,
  "isDownloadable": true,
  "license": "none",
  "noai": true,
  "isAiGenerated": false,
  "thumbnailUrl": "https://images-wixmp-ed30a86b8c4ca887773594c2.wixmp.com/f/.../nera2_by_wlop_dmwzr8e-300w.jpg?token=...",
  "dataSource": "page",
  "source": "wlop"
}
```

**Field notes**

- `noai` is DeviantArt's `isAiUseDisallowed` flag, passed through unchanged. `true` means the artist has not allowed AI use of the work.
- `license` is the artist's license, e.g. `none` (all rights reserved) or a Creative Commons code.
- `tags` is always filled for deviation URLs; for search and gallery results only with `includeTags` (otherwise `null`).
- `category` is the deviation type (`image`, `literature`, `film`, ...). DeviantArt no longer exposes its legacy category paths.
- `thumbnailUrl` is a link only. The actor never fetches it.
- Profile items (`type: "profile"`) fill `watchers`, `watching`, `deviationCount`, `pageviews`, `tagline`, `country`, `joinedAt` and `avatarUrl`.
- `dataSource` is `page` for full metadata. `oembed` or `rss` marks a fallback item with partial data (no license, `noai` or watcher count).

## Acceptable use and AI training

- This actor returns **public metadata only**. It downloads **no images** and no deviation files.
- It **passes the `noai` flag through** on every deviation so you can honour it.
- **Do not use the output for AI training of `noai`-tagged works.** DeviantArt's Terms of Service (§24) forbid using Content flagged `noai` to train AI or as input to an AI system. This actor is not a training-data source.
- You are responsible for how you use the data and for complying with DeviantArt's terms, artists' licenses and applicable law.

## How does the DeviantArt scraper work?

1. It loads public, logged-out pages: `/search?q=...&page=N`, `/<user>/gallery?page=N`, `/<user>` and `/<user>/art/<title>-<id>`.
2. It parses the page's embedded `window.__INITIAL_STATE__` data. No browser is needed.
3. If a page can't be parsed, it falls back to DeviantArt's public `backend.deviantart.com/oembed` (deviation URLs) or `rss.xml` feed (search and galleries).
4. It respects robots.txt. It never requests `cursor=` URLs, `/users/*?`, `/api/` or the internal `_puppy` API. It waits at least 1 second between requests, and retries rate limits and network errors with backoff.
5. Unknown users and deviations (404) are logged and skipped. The run continues.

## How much does it cost to scrape DeviantArt?

Pay-per-event:

| Event     | Price      | Per 1,000 |
| --------- | ---------- | --------- |
| Deviation | **$0.003** | $3.00     |
| Profile   | **$0.001** | $1.00     |

Items that are skipped (mature, older than `sinceDate`), not found or failed are not charged. A small `$0.00005` actor-start fee covers the first few seconds of compute. If you set a **maximum cost per run**, the actor stops cleanly when it reaches it.

## Who uses DeviantArt metadata?

- **Art directors and agencies** scout artists by watchers, favourites and recent output.
- **Artists and communities** track their own or peers' galleries and engagement over time.
- **Researchers** study trends in art communities, licensing and `noai` opt-outs.
- **AI agents** look up deviation or artist stats on demand via the Apify MCP server.

## DeviantArt scraper FAQ

**Does it download images?** No. It returns metadata and a thumbnail URL only, and never fetches images or deviation files.

**What is the `noai` flag?** DeviantArt lets artists mark work as not allowed for AI use. The actor returns that flag as `noai` for every deviation. Don't use `noai` works for AI training or as AI input.

**Does it return mature content?** Only with `includeMature`, and only what DeviantArt shows to logged-out visitors. By default mature deviations are skipped and not billed.

**Do I need a login or API key?** No. It reads the same public pages any visitor sees.

**How do I monitor for new deviations?** Use `userGallery` with `sinceDate` (e.g. `7 days`) on a schedule. Search results are ranked by relevance, so in search mode `sinceDate` only filters results.

**Can I use it through the API or with AI agents?** Yes. Call it through the Apify API, the Apify MCP server or any Apify integration. Pricing is per event only.

**Disclaimer:** This actor is not affiliated with, endorsed by or sponsored by DeviantArt. DeviantArt is a trademark of DeviantArt, Inc.

## Related actors

- [SoundCloud Scraper](https://apify.com/cprussin/soundcloud-metadata?fpr=to54nm): SoundCloud track, user and playlist metadata (no audio).
- [AI Image Upscaler](https://apify.com/cprussin/image-upscaler?fpr=to54nm): Upscale and enhance images 2x, 3x or 4x with Real-ESRGAN.
- [Substack Scraper](https://apify.com/cprussin/substack-scraper?fpr=to54nm): Posts, full text and engagement stats from any Substack newsletter.
