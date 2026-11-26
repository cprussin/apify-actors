# Whisper Transcriber: Audio, Video & Podcast to Text, SRT and VTT

**Whisper Transcriber** turns **audio files, video files and podcast RSS feeds** into **text**, **timestamped segments**, **SRT and VTT subtitles** and **RAG-ready chunks**, with **automatic language detection**. It runs OpenAI's open-source **Whisper** model (via faster-whisper) inside the actor: **no API key, no OpenAI account, no per-token fees**. Paste file links, point it at your own uploads, or give it a podcast feed and schedule it to transcribe **only new episodes**.

- ✅ **Any audio or video file**: MP3, M4A, WAV, OGG, OPUS, FLAC, AAC, MP4, MOV, MKV, WEBM and more. Video files are fine: only the audio track is used.
- ✅ **Podcast RSS feeds** with a **new-episodes mode**: schedule the actor daily and each new episode is transcribed exactly once.
- ✅ **Published transcripts first**: when an episode links its own transcript (`<podcast:transcript>`, e.g. Omny, Buzzsprout, Transistor), you get it in the same text/segments/SRT/VTT shape for **$0.01 per episode**, no Whisper wait.
- ✅ **SRT and VTT subtitles** for every file, plus the full text and **timestamped segments** in the dataset.
- ✅ **Language detection** across Whisper's 99 languages, or set the language yourself. **Translate to English** from any of them at the same price.
- ✅ **Whisper word timestamps** (start, end and confidence per word) and a **vocabulary** for names and jargon.
- ✅ **Chain from a scraper**: transcribe every media URL in another actor's dataset (`datasetId`) or in pasted rows.
- ✅ **RAG chunks with start and end times**, ready for a vector database. Pairs with [Document to Markdown](https://apify.com/cprussin/document-to-markdown?fpr=to54nm) for PDFs and Office files.
- ✅ **No API key**: Whisper runs inside the actor. Your audio isn't sent to an AI provider.
- ✅ **Batch-safe**: a 404, a web page, a corrupt or over-long file never fails the run. You get an item with the reason, for free.
- ✅ **Respects robots.txt**: feeds, files and published transcripts are skipped (free, `status: "skipped_robots"`) when the host's robots.txt disallows them or opts out of Claude's crawlers.
- ✅ **Pay per audio minute**: $0.008/min (base model) or $0.016/min (small model), or $0.01 per episode with a published transcript. No start fee.

## Start in one minute

Click **Start** with the prefilled input:

```json
{
  "urls": [
    "https://www.nasa.gov/wp-content/uploads/2015/01/590325main_ringtone_kennedy_WeChoose.mp3"
  ]
}
```

You get: A transcript of a 20-second NASA clip of JFK's "We choose to go to the Moon" speech: `text`, timestamped `segments`, detected `language`, `durationSeconds`, and `srtUrl`/`vttUrl` subtitle links.

**Cost:** $0.008: 1 minute × $0.008 (base model, billed per started minute). No start fee.

## Use with an AI assistant

Connect the [Apify MCP server](https://mcp.apify.com) to Claude, ChatGPT, Cursor or any MCP client (`https://mcp.apify.com?tools=cprussin/media-transcriber` loads only this actor), then paste:

```text
Use the Apify actor cprussin/media-transcriber to transcribe https://www.nasa.gov/wp-content/uploads/2015/01/590325main_ringtone_kennedy_WeChoose.mp3, and give me the text and the SRT subtitle link.
```

## Recipes

### New podcast episodes, daily

The 3 newest episodes of a feed published since January, without trailers; schedule the same input daily to transcribe only new ones.

```json
{
  "rssFeeds": ["https://feeds.example.com/my-podcast.xml"],
  "maxEpisodes": 3,
  "onlyNewEpisodes": true,
  "publishedAfter": "2026-01-01",
  "titleExcludes": ["trailer"],
  "model": "base"
}
```

### Published podcast transcripts only (no Whisper)

Shows that publish transcripts in their feed, at $0.01 per episode; episodes without one are skipped for free.

```json
{
  "rssFeeds": [
    "https://omny.fm/shows/stuff-you-should-know-1/playlists/podcast.rss"
  ],
  "maxEpisodes": 10,
  "publishedOnly": true
}
```

### Interviews with word timestamps and a vocabulary

Your own uploaded recording with the `small` model, Whisper word timestamps (each word's start, end and confidence) and the names it should spell right. Add `"translateToEnglish": true` to get an English transcript of a recording in any language.

```json
{
  "keyValueStoreRecords": ["my-user~interviews/call-2026-10-01.m4a"],
  "model": "small",
  "language": "en",
  "wordTimestamps": true,
  "vocabulary": "Kubernetes, Grafana, Dr. Nguyen"
}
```

### RAG chunks with timestamps

One item per chunk, each with its start and end time.

```json
{
  "urls": [
    "https://www.nasa.gov/wp-content/uploads/2015/01/590325main_ringtone_kennedy_WeChoose.mp3"
  ],
  "outputFormat": "chunks",
  "chunkSize": 1000,
  "chunkOverlap": 100
}
```

### Transcribe dataset videos (chain from a scraper)

Transcribe the media URL of each row of another actor's dataset (the first of `url`, `videoUrl`, `mediaUrl`, `audioUrl`, `downloadUrl`, `fileUrl`, or the field you name, dot paths ok). Files over 30 minutes are skipped with a free error item. Each item gets `sourceDatasetId` and `sourceItemIndex`, so you can join the transcript back to the row.

```json
{
  "datasetId": "YOUR_DATASET_ID",
  "datasetField": "audioUrl",
  "maxDatasetItems": 100,
  "maxDurationMinutes": 30
}
```

Agents and pipelines can paste the rows instead: `"datasetItems": [{ "audioUrl": "https://example.com/a.mp3" }]`.

## What can I use audio and video transcription for?

- **Podcast monitoring and research**: transcribe every new episode of the shows you follow, then search, summarize or quote them.
- **Subtitles and captions**: SRT/VTT files for videos, courses, webinars and social clips.
- **RAG and AI assistants**: chunk transcripts with timestamps, embed them, and link answers to the exact minute.
- **Content repurposing**: turn talks, interviews and videos into blog posts, show notes, newsletters or LLM prompts.
- **Meetings and interviews**: transcribe recordings you upload to an Apify key-value store.
- **AI agents**: give an agent a "listen to this file" tool through the Apify API or MCP server.

## How does it work?

1. Each feed, file and published transcript URL (and every redirect hop) is checked against its host's robots.txt (loaded once per host per run). It's skipped for free when the `*` group disallows it, when robots.txt has a group for a Claude crawler (`ClaudeBot`, `Claude-User`, `Claude-Web`, `anthropic-ai`), or when robots.txt can't be verified (an HTTP status other than 200/404, or an HTML page). Megaphone-hosted feeds and audio (`feeds.megaphone.fm`, `traffic.megaphone.fm`) are skipped this way.
2. Each file is downloaded (with size and time limits), each key-value store record is read, and each RSS feed is fetched for its newest episodes. An episode with a `<podcast:transcript>` link uses that transcript instead (VTT, SRT and JSON first, then plain text and HTML); if it's missing or broken, the audio is transcribed as below.
3. [FFmpeg](https://ffmpeg.org/) decodes the audio track to 16 kHz mono. Files longer than **Max duration** are skipped (free).
4. [faster-whisper](https://github.com/SYSTRAN/faster-whisper) transcribes it on CPU with voice activity detection, which skips silence and music and reduces hallucinated text.
5. You get the text, segments, detected language and duration, and links to the SRT and VTT files.

## How do I transcribe audio, video or a podcast?

| Field                        | Description                                                               | Default          |
| ---------------------------- | ------------------------------------------------------------------------- | ---------------- |
| `urls`                       | Direct links to audio or video files, one per line                        | a 20 s NASA clip |
| `startUrls`                  | Same, in Apify request-list format (combined with `urls`)                 | none             |
| `keyValueStoreRecords`       | Uploaded files, as `storeId/recordKey` or `username~store-name/recordKey` | none             |
| `datasetId`, `datasetField`  | A dataset whose rows hold media URLs, and the field (empty: auto-detect)  | none             |
| `datasetItems`               | Dataset rows pasted as JSON                                               | none             |
| `maxDatasetItems`            | At most this many dataset rows are read                                   | `100`            |
| `rssFeeds`                   | Podcast RSS or Atom feed URLs                                             | none             |
| `maxEpisodes`                | Newest episodes per feed to consider                                      | `5`              |
| `publishedAfter`             | Only episodes published on or after this date                             | none             |
| `titleContains`              | Only episodes whose title contains one of these (case-insensitive)        | none             |
| `titleExcludes`              | Skip episodes whose title contains any of these                           | none             |
| `onlyNewEpisodes`            | Skip episodes transcribed by an earlier run with the same feeds           | `false`          |
| `preferPublishedTranscripts` | Use an episode's own `<podcast:transcript>` instead of Whisper            | `true`           |
| `publishedOnly`              | Never run Whisper on episodes; no published transcript → free skip        | `false`          |
| `model`                      | `base` (fast, $0.008/min) or `small` (more accurate, $0.016/min)          | `base`           |
| `language`                   | `auto` or a language code (`en`, `de`, `es`, `fr`, `ja`, `zh`, ...)       | `auto`           |
| `translateToEnglish`         | Whisper writes English whatever is spoken                                 | `false`          |
| `wordTimestamps`             | Add `words` (start, end, word, probability) to each segment               | `false`          |
| `vocabulary`                 | Names and jargon for Whisper's initial prompt (about 220 tokens)          | none             |
| `outputFormat`               | `transcript` (one item per file) or `chunks` (one item per RAG chunk)     | `transcript`     |
| `chunkSize`                  | Max characters per chunk, overlap included                                | `1500`           |
| `chunkOverlap`               | Characters of whole segments repeated from the previous chunk             | `150`            |
| `maxDurationMinutes`         | Longer files are skipped with a free error (at most 300)                  | `180`            |
| `maxFileSizeMb`              | Larger downloads are skipped with a free error                            | `1000`           |
| `timeoutSecs`                | Max download time per file                                                | `600`            |

**Transcribing your own recordings:** upload them to a key-value store in your Apify account (Storage → Key-value stores → your store → upload a record) and list them in `keyValueStoreRecords`, e.g. `my-user~interviews/call-2026-10-01.m4a`. Private record URLs (`https://api.apify.com/v2/key-value-stores/.../records/...`) also work in `urls`; the actor reads them with your run's token.

**YouTube, TikTok and Instagram links are not supported** (you get a free error item). For YouTube captions, use [YouTube Transcripts](https://apify.com/cprussin/youtube-transcripts?fpr=to54nm).

## What data do you get?

**Transcript** (`outputFormat: "transcript"`): one item per file (shortened):

```json
{
  "url": "https://www.nasa.gov/wp-content/uploads/2015/01/590325main_ringtone_kennedy_WeChoose.mp3",
  "status": "transcribed",
  "transcriptSource": "whisper",
  "publishedTranscriptUrl": null,
  "sourceType": "url",
  "sourceDatasetId": null,
  "sourceItemIndex": null,
  "title": "590325main_ringtone_kennedy_WeChoose.mp3",
  "model": "base",
  "task": "transcribe",
  "vocabularyUsed": null,
  "language": "en",
  "languageProbability": 0.9672,
  "durationSeconds": 20.088,
  "billedMinutes": 1,
  "text": "We choose to go to the moon and disdicate and do the other things, not because they are easy, but because they are hot. Three, two, one, zero, all engine running. Lift off, we have a lift off, 32 minutes past the hour, lift off on Apollo 11.",
  "segments": [
    {
      "start": 0.0,
      "end": 7.8,
      "text": "We choose to go to the moon and disdicate and do the other things, not because they are easy, but because they are hot."
    }
  ],
  "segmentCount": 3,
  "wordCount": 48,
  "srtUrl": "https://api.apify.com/v2/key-value-stores/.../records/transcript-0001.srt",
  "vttUrl": "https://api.apify.com/v2/key-value-stores/.../records/transcript-0001.vtt",
  "warning": null,
  "error": null,
  "transcribedAt": "2026-10-07T13:20:00.000Z"
}
```

That is the fast `base` model; `small` gets this clip word-perfect ("...in this decade... because they are hard."). Podcast episodes also have `feedUrl`, `podcastTitle`, `episodeGuid` and `publishedAt`, and `title` is the episode title.

**Published transcripts** have `transcriptSource: "published"`, `publishedTranscriptUrl` (the feed's transcript link), `billedMinutes: 0`, and the language from the tag or the feed. Timed formats (VTT, SRT, JSON, timestamped text) give segments, SRT and VTT; untimed plain text or HTML gives the `text` (paragraphs) with `segments`, `srtUrl` and `vttUrl` set to `null`. VTT and JSON speaker names are kept as `speaker` on each segment.

**Word timestamps** (`wordTimestamps: true`): each Whisper segment also has `words`, e.g. `{ "start": 0.42, "end": 0.71, "word": " choose", "probability": 0.98 }`. `task` is `translate` with `translateToEnglish` (the `language` is still the spoken one), and `vocabularyUsed` is the vocabulary Whisper was given.

**RAG chunks** (`outputFormat: "chunks"`): one item per chunk, with the same file fields plus `chunkIndex`, `chunkCount`, `startTime` and `endTime` (seconds), and the chunk's `text`. Chunks break between Whisper segments, so every chunk maps to an exact time range.

- **SRT and VTT** files are saved in the run's key-value store as `transcript-0001.srt` / `.vtt` and linked from every item.
- Every item has a `status`: `transcribed`, `failed`, `skipped_robots` or `no_published_transcript` (with `publishedOnly`). Only `transcribed` items are billed.
- Failed files are returned with `text: null` and an `error`, such as `Download failed: HTTP 404.`, `This link is a web page, not an audio or video file.`, `The media is 212.4 min long, over the 180.0 min limit (maxDurationMinutes).` or `No speech detected.`

## How much does audio transcription cost?

Pay per event, per **started minute** of audio actually transcribed. No subscription, no start fee, compute included:

| Model                   | Price per audio minute | 1-hour podcast |
| ----------------------- | ---------------------- | -------------- |
| `base` (default)        | **$0.008**             | $0.48          |
| `small` (more accurate) | **$0.016**             | $0.96          |
| Published transcript    | **$0.01 per episode**  | $0.01          |

A 30 min 20 s file is billed as 31 minutes. An episode is charged either audio minutes or one published-transcript event, never both. Failed files, files over your limits, robots.txt skips and episodes skipped by new-episodes mode are free. If you set a **maximum cost per run**, the actor never starts a file the remaining budget can't pay for: it skips it with a free error item and moves on to shorter files.

## Tips

- **Which model?** `base` is fine for clear speech (podcasts, lectures, audiobooks). Use `small` for accents, noisy recordings, crosstalk, names and most non-English audio.
- **Speed**: on the default 4 GB memory (1 CPU core), `base` transcribes about 9 minutes of audio per minute and `small` about 3. More memory gives more cores (4 GB per core) and faster runs.
- **Language**: auto-detection uses the start of each file. Set the language for short clips or when the first seconds are music or another language.
- **Long files**: the default run timeout may be too short for many hours of audio with `small`; raise the run timeout or split the batch.
- **Podcasts**: use the show's RSS feed URL (on Apple Podcasts, Spotify-for-Creators, Buzzsprout, Libsyn, Podbean and other hosting pages, or search the show name plus "RSS"). `maxEpisodes` caps each run; with `onlyNewEpisodes`, only the newest `maxEpisodes` episodes are checked for new ones.

## FAQ

**Is this OpenAI's Whisper API?** No. It runs the open-source Whisper `base` and `small` models (MIT license) locally inside the actor with faster-whisper and CTranslate2. No API key, no data sent to OpenAI.

**Which languages are supported?** All 99 Whisper languages, with automatic detection. Accuracy is best for English and widely spoken languages; use the `small` model for others.

**Does it identify speakers?** Whisper has no speaker diarization: its segments have timestamps but no speaker labels. Published transcripts keep the publisher's speaker names (`speaker` on each segment) when they have them.

**Can I transcribe YouTube or TikTok videos?** Not by page link. Use direct media file links, your own uploads or podcast feeds. For YouTube captions, see [YouTube Transcripts](https://apify.com/cprussin/youtube-transcripts?fpr=to54nm).

**How long can a file be?** Up to `maxDurationMinutes` (default 180, at most 300). Longer files are skipped for free.

**Can AI agents use it?** Yes, through the Apify API, the Apify MCP server or any Apify integration (Make, Zapier, n8n, LangChain, LlamaIndex).

**Disclaimer:** You are responsible for having the right to process the media you submit.

## Open-source software

This actor is built on [faster-whisper](https://github.com/SYSTRAN/faster-whisper) and [CTranslate2](https://github.com/OpenNMT/CTranslate2) (MIT), OpenAI's [Whisper](https://github.com/openai/whisper) model weights (MIT) and [FFmpeg](https://ffmpeg.org/) (an LGPL-2.1 build, decoders only). See `THIRD_PARTY_NOTICES.md` in the source for all notices. It is not affiliated with or endorsed by OpenAI, SYSTRAN or the FFmpeg project.

## Related actors

- [YouTube Transcript Scraper](https://apify.com/cprussin/youtube-transcripts?fpr=to54nm): YouTube transcripts as text, segments, SRT or VTT, for AI and RAG.
- [Video Frame Extractor](https://apify.com/cprussin/video-frame-extractor?fpr=to54nm): Thumbnails, scene keyframes, contact sheets and GIFs from video files.
- [PDF to Markdown Converter](https://apify.com/cprussin/document-to-markdown?fpr=to54nm): PDF, Word, PowerPoint, Excel and EPUB to Markdown or RAG chunks.
