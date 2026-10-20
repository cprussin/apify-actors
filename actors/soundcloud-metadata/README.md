# SoundCloud Metadata Scraper: Tracks, Users & Playlists

**SoundCloud Metadata Scraper** returns metadata for **SoundCloud tracks, users (artists) and playlists** from the public SoundCloud API. Paste track, profile or playlist URLs, or run a keyword **search** for tracks, users or playlists. For each item you get the title, owner, play / like / repost / comment counts, duration, genre, tags, created date, artwork, description and more. **No audio is downloaded** — metadata only. No login or API key needed.

- ✅ **Resolve any URL:** tracks (`/user/track`), users (`/user`) and playlists/albums (`/user/sets/name`).
- ✅ **Keyword search:** tracks, users or playlists, with a result cap so trials are cheap.
- ✅ **Engagement stats:** plays, likes, reposts, comments, followers, track counts.
- ✅ **Metadata only:** titles, genres, tags, durations, artwork and descriptions. No audio, no copyrighted stream is ever fetched.
- ✅ Fast and light: uses SoundCloud's public `api-v2` endpoints. No browser, no proxy needed.
- ✅ Pay only per item returned.

## Start in one minute

Click **Start** with the prefilled input:

```json
{
  "urls": [
    "https://soundcloud.com/edsheeran/shape-of-you",
    "https://soundcloud.com/postmalone/rockstar-feat-21-savage",
    "https://soundcloud.com/edsheeran"
  ],
  "maxItems": 10,
  "proxyConfiguration": {
    "useApifyProxy": false
  }
}
```

You get: three dataset items — two tracks (with `playbackCount`, `likesCount`, `genre`, `durationMs`) and one user (with `followersCount`, `trackCount`).

**Cost:** about $0.006: 3 items × $0.002, plus the $0.00005 actor-start fee.

## Use with an AI assistant

Connect the [Apify MCP server](https://mcp.apify.com) to Claude, ChatGPT, Cursor or any MCP client (`https://mcp.apify.com?tools=cprussin/soundcloud-metadata` loads only this actor), then paste:

```text
Use the Apify actor cprussin/soundcloud-metadata to search SoundCloud for the 10 most relevant "lofi hip hop" tracks and list their play and like counts.
```

## Recipes

### Resolve specific tracks, a profile and a playlist

Mix track, user and playlist URLs; each resolves to one item.

```json
{
  "urls": [
    "https://soundcloud.com/edsheeran/shape-of-you",
    "https://soundcloud.com/edsheeran",
    "https://soundcloud.com/lofi_chill/sets/lofi-chill"
  ]
}
```

### Search tracks by keyword

The 25 most relevant tracks for a keyword, with plays, likes and genre.

```json
{
  "search": "lofi hip hop",
  "searchType": "tracks",
  "maxItems": 25
}
```

### Find artists (users)

Search user profiles by name to get follower and track counts.

```json
{
  "search": "drake",
  "searchType": "users",
  "maxItems": 10
}
```

### Search playlists

Find playlists and albums matching a keyword.

```json
{
  "search": "chill",
  "searchType": "playlists",
  "maxItems": 15
}
```

## What data do you get for each item?

One dataset item per track, user or playlist. Fields that don't apply to a type are `null`. Example (a track, shortened):

```json
{
  "type": "track",
  "id": 406715293,
  "url": "https://soundcloud.com/edsheeran/shape-of-you",
  "title": "Shape of You",
  "username": "Ed Sheeran",
  "userUrl": "https://soundcloud.com/edsheeran",
  "genre": "Pop",
  "tags": ["Pop"],
  "createdAt": "2017-01-06T00:00:00Z",
  "durationMs": 233840,
  "playbackCount": 84266602,
  "likesCount": 1049387,
  "repostsCount": 48213,
  "commentCount": 3120,
  "labelName": "Atlantic Records UK",
  "artworkUrl": "https://i1.sndcdn.com/artworks-Ar69BodfFm7L-0-large.jpg",
  "source": "https://soundcloud.com/edsheeran/shape-of-you"
}
```

**Field notes**

- `type` is `track`, `user` or `playlist`. Track-only fields (plays, comments), user-only fields (followers, city, verified) and playlist-only fields (trackCount, isAlbum) are `null` on other types.
- `createdAt` is an ISO 8601 UTC timestamp.
- `tags` is parsed from SoundCloud's tag list (multi-word tags are preserved).
- `durationMs` is the length in milliseconds (tracks and playlists).
- No audio stream is ever fetched; `downloadable`/`streamable` only report the uploader's flags.

## How does the SoundCloud scraper work?

1. The actor fetches the SoundCloud homepage and extracts the anonymous `client_id` from the referenced JavaScript bundles. It caches it and re-extracts a fresh one automatically if SoundCloud rotates it (HTTP 401).
2. Each URL in `urls` is resolved with `GET /resolve?url=...` on `api-v2.soundcloud.com` into a track, user or playlist object.
3. A `search` keyword is sent to `/search/tracks`, `/search/users` or `/search/playlists` (by `searchType`) and paged up to `maxItems`.
4. Rate limits and network errors are retried with exponential backoff. URLs that 404 or point to unsupported pages are logged and skipped. The run continues.

## How much does it cost to scrape SoundCloud?

Pay-per-event. You are charged **one** event per item written to the dataset:

| Event                          | Price      | Per 1,000 items |
| ------------------------------ | ---------- | --------------- |
| Item (track, user or playlist) | **$0.002** | $2.00           |

Items that fail to load or are not found are not charged. A small `$0.00005` actor-start fee covers the first few seconds of compute. If you set a **maximum cost per run**, the actor stops cleanly when it reaches it.

## Who uses SoundCloud metadata?

- **A&R and labels** track emerging artists by plays, likes and follower growth.
- **Playlist curators and marketers** find tracks and playlists in a genre or around a keyword.
- **Researchers and data teams** build datasets of track and artist metadata.
- **AI agents** look up track, artist or playlist stats on demand via the Apify MCP server.

## SoundCloud scraper FAQ

**Does it download audio?** No. It only returns metadata from SoundCloud's public API. It never fetches an audio stream or file, so it does not touch copyrighted audio.

**Do I need a login or API key?** No. The actor extracts SoundCloud's own anonymous `client_id` and uses the public `api-v2` endpoints.

**What URLs are supported?** Track URLs (`soundcloud.com/user/track`), user/profile URLs (`soundcloud.com/user`) and playlist/album URLs (`soundcloud.com/user/sets/name`).

**Can I use it through the API or with AI agents?** Yes. Call it through the Apify API, the Apify MCP server or any Apify integration. Pricing is per event only.

**Is scraping SoundCloud legal?** The actor only collects publicly available metadata that SoundCloud serves to every visitor, and never downloads audio. You are responsible for how you use the data and for complying with SoundCloud's terms and applicable law.

**Disclaimer:** This actor is not affiliated with, endorsed by or sponsored by SoundCloud. SoundCloud is a trademark of SoundCloud Global Limited & Co. KG.

## Related actors

- [YouTube Transcript Scraper](https://apify.com/cprussin/youtube-transcripts?fpr=to54nm): YouTube transcripts as text, segments, SRT or VTT, for AI and RAG.
- [DeviantArt Scraper](https://apify.com/cprussin/deviantart-metadata?fpr=to54nm): DeviantArt deviation, gallery and profile metadata (no images downloaded).
- [Whisper Audio & Video Transcriber](https://apify.com/cprussin/media-transcriber?fpr=to54nm): Audio, video and podcast transcription with Whisper, with SRT and VTT subtitles.
