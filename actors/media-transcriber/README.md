# Whisper Transcriber: Audio, Video & Podcast to Text, SRT and VTT

**Whisper Transcriber** turns **audio files, video files and podcast RSS feeds** into **text**, **timestamped segments**, **SRT and VTT subtitles** and **RAG-ready chunks**, with **automatic language detection**. It runs OpenAI's open-source **Whisper** model (via faster-whisper) inside the actor: **no API key, no OpenAI account, no per-token fees**. Paste file links, point it at your own uploads, or give it a podcast feed and schedule it to transcribe **only new episodes**.

- ✅ **Any audio or video file**: MP3, M4A, WAV, OGG, OPUS, FLAC, AAC, MP4, MOV, MKV, WEBM and more. Video files are fine: only the audio track is used.
- ✅ **Podcast RSS feeds** with a **new-episodes mode**: schedule the actor daily and each new episode is transcribed exactly once.
- ✅ **SRT and VTT subtitles** for every file, plus the full text and **timestamped segments** in the dataset.
- ✅ **Language detection** across Whisper's 99 languages, or set the language yourself.
- ✅ **RAG chunks with start and end times**, ready for a vector database. Pairs with [Document to Markdown](https://apify.com/cprussin/document-to-markdown?fpr=to54nm) for PDFs and Office files.
- ✅ **No API key**: Whisper runs inside the actor. Your audio isn't sent to an AI provider.
- ✅ **Batch-safe**: a 404, a web page, a corrupt or over-long file never fails the run. You get an item with the reason, for free.
- ✅ **Pay per audio minute**: $0.008/min (base model) or $0.016/min (small model). No start fee.

## What can I use audio and video transcription for?

- **Podcast monitoring and research**: transcribe every new episode of the shows you follow, then search, summarize or quote them.
- **Subtitles and captions**: SRT/VTT files for videos, courses, webinars and social clips.
- **RAG and AI assistants**: chunk transcripts with timestamps, embed them, and link answers to the exact minute.
- **Content repurposing**: turn talks, interviews and videos into blog posts, show notes, newsletters or LLM prompts.
- **Meetings and interviews**: transcribe recordings you upload to an Apify key-value store.
- **AI agents**: give an agent a "listen to this file" tool through the Apify API or MCP server.

## How does it work?

1. Each file is downloaded (with size and time limits), each key-value store record is read, and each RSS feed is fetched for its newest episodes.
2. [FFmpeg](https://ffmpeg.org/) decodes the audio track to 16 kHz mono. Files longer than **Max duration** are skipped (free).
3. [faster-whisper](https://github.com/SYSTRAN/faster-whisper) transcribes it on CPU with voice activity detection, which skips silence and music and reduces hallucinated text.
4. You get the text, segments, detected language and duration, and links to the SRT and VTT files.

## How do I transcribe audio, video or a podcast?

| Field                  | Description                                                               | Default          |
| ---------------------- | ------------------------------------------------------------------------- | ---------------- |
| `urls`                 | Direct links to audio or video files, one per line                        | a 20 s NASA clip |
| `startUrls`            | Same, in Apify request-list format (combined with `urls`)                 | none             |
| `keyValueStoreRecords` | Uploaded files, as `storeId/recordKey` or `username~store-name/recordKey` | none             |
| `rssFeeds`             | Podcast RSS or Atom feed URLs                                             | none             |
| `maxEpisodes`          | Newest episodes per feed to consider                                      | `5`              |
| `onlyNewEpisodes`      | Skip episodes transcribed by an earlier run with the same feeds           | `false`          |
| `model`                | `base` (fast, $0.008/min) or `small` (more accurate, $0.016/min)          | `base`           |
| `language`             | `auto` or a language code (`en`, `de`, `es`, `fr`, `ja`, `zh`, ...)       | `auto`           |
| `outputFormat`         | `transcript` (one item per file) or `chunks` (one item per RAG chunk)     | `transcript`     |
| `chunkSize`            | Max characters per chunk, overlap included                                | `1500`           |
| `chunkOverlap`         | Characters of whole segments repeated from the previous chunk             | `150`            |
| `maxDurationMinutes`   | Longer files are skipped with a free error (at most 300)                  | `180`            |
| `maxFileSizeMb`        | Larger downloads are skipped with a free error                            | `1000`           |
| `timeoutSecs`          | Max download time per file                                                | `600`            |

Example: transcribe the 3 newest episodes of a podcast, then schedule the same input daily to get only new ones:

```json
{
  "rssFeeds": ["https://feeds.example.com/my-podcast.xml"],
  "maxEpisodes": 3,
  "onlyNewEpisodes": true,
  "model": "base"
}
```

**Transcribing your own recordings:** upload them to a key-value store in your Apify account (Storage → Key-value stores → your store → upload a record) and list them in `keyValueStoreRecords`, e.g. `my-user~interviews/call-2026-10-01.m4a`. Private record URLs (`https://api.apify.com/v2/key-value-stores/.../records/...`) also work in `urls`; the actor reads them with your run's token.

**YouTube, TikTok and Instagram links are not supported** (you get a free error item). For YouTube captions, use [YouTube Transcripts](https://apify.com/cprussin/youtube-transcripts?fpr=to54nm).

## What data do you get?

**Transcript** (`outputFormat: "transcript"`): one item per file (shortened):

```json
{
  "url": "https://www.nasa.gov/wp-content/uploads/2015/01/590325main_ringtone_kennedy_WeChoose.mp3",
  "sourceType": "url",
  "title": "590325main_ringtone_kennedy_WeChoose.mp3",
  "model": "base",
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

**RAG chunks** (`outputFormat: "chunks"`): one item per chunk, with the same file fields plus `chunkIndex`, `chunkCount`, `startTime` and `endTime` (seconds), and the chunk's `text`. Chunks break between Whisper segments, so every chunk maps to an exact time range.

- **SRT and VTT** files are saved in the run's key-value store as `transcript-0001.srt` / `.vtt` and linked from every item.
- Failed files are returned with `text: null` and an `error`, such as `Download failed: HTTP 404.`, `This link is a web page, not an audio or video file.`, `The media is 212.4 min long, over the 180.0 min limit (maxDurationMinutes).` or `No speech detected.`

## How much does audio transcription cost?

Pay per event, per **started minute** of audio actually transcribed. No subscription, no start fee, compute included:

| Model                   | Price per audio minute | 1-hour podcast |
| ----------------------- | ---------------------- | -------------- |
| `base` (default)        | **$0.008**             | $0.48          |
| `small` (more accurate) | **$0.016**             | $0.96          |

A 30 min 20 s file is billed as 31 minutes. Failed files, files over your limits and episodes skipped by new-episodes mode are free. If you set a **maximum cost per run**, the actor never starts a file the remaining budget can't pay for: it skips it with a free error item and moves on to shorter files.

## Tips

- **Which model?** `base` is fine for clear speech (podcasts, lectures, audiobooks). Use `small` for accents, noisy recordings, crosstalk, names and most non-English audio.
- **Speed**: on the default 4 GB memory (1 CPU core), `base` transcribes about 9 minutes of audio per minute and `small` about 3. More memory gives more cores (4 GB per core) and faster runs.
- **Language**: auto-detection uses the start of each file. Set the language for short clips or when the first seconds are music or another language.
- **Long files**: the default run timeout may be too short for many hours of audio with `small`; raise the run timeout or split the batch.
- **Podcasts**: use the show's RSS feed URL (on Apple Podcasts, Spotify-for-Creators, Buzzsprout, Libsyn, Podbean and other hosting pages, or search the show name plus "RSS"). `maxEpisodes` caps each run; with `onlyNewEpisodes`, only the newest `maxEpisodes` episodes are checked for new ones.

## FAQ

**Is this OpenAI's Whisper API?** No. It runs the open-source Whisper `base` and `small` models (MIT license) locally inside the actor with faster-whisper and CTranslate2. No API key, no data sent to OpenAI.

**Which languages are supported?** All 99 Whisper languages, with automatic detection. Accuracy is best for English and widely spoken languages; use the `small` model for others.

**Does it identify speakers?** No, there is no speaker diarization. Segments have timestamps but no speaker labels.

**Can I transcribe YouTube or TikTok videos?** Not by page link. Use direct media file links, your own uploads or podcast feeds. For YouTube captions, see [YouTube Transcripts](https://apify.com/cprussin/youtube-transcripts?fpr=to54nm).

**How long can a file be?** Up to `maxDurationMinutes` (default 180, at most 300). Longer files are skipped for free.

**Can AI agents use it?** Yes, through the Apify API, the Apify MCP server or any Apify integration (Make, Zapier, n8n, LangChain, LlamaIndex).

**Disclaimer:** You are responsible for having the right to process the media you submit.

## Open-source software

This actor is built on [faster-whisper](https://github.com/SYSTRAN/faster-whisper) and [CTranslate2](https://github.com/OpenNMT/CTranslate2) (MIT), OpenAI's [Whisper](https://github.com/openai/whisper) model weights (MIT) and [FFmpeg](https://ffmpeg.org/) (an LGPL-2.1 build, decoders only). See `THIRD_PARTY_NOTICES.md` in the source for all notices. It is not affiliated with or endorsed by OpenAI, SYSTRAN or the FFmpeg project.

## Related actors

- [document-to-markdown](https://apify.com/cprussin/document-to-markdown?fpr=to54nm): PDF, Word, PowerPoint, Excel and EPUB to Markdown or RAG chunks.
- [youtube-transcripts](https://apify.com/cprussin/youtube-transcripts?fpr=to54nm): YouTube transcripts as text, segments, SRT or VTT, for AI and RAG.
- [website-screenshot](https://apify.com/cprussin/website-screenshot?fpr=to54nm): Full-page or viewport screenshots and PDFs of any URL.
