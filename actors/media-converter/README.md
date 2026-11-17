# Video & Audio Converter: MP4, WebM, MP3, M4A, WAV

**Video & Audio Converter** turns video and audio files into **MP4 (H.264), WebM (VP9), MP3, M4A or WAV**, and compresses them on the way. Pick a quality or a **target file size in MB**, shrink to **480p, 720p or 1080p**, trim to a start and length, or remove the audio. Paste direct file links or point it at your own uploads, and get a download link for each file with its codecs, resolution, bitrate and the bytes saved. It runs [FFmpeg](https://ffmpeg.org/) inside the actor: **no API key, no external service**.

- ✅ **Five output formats**: MP4 (H.264 + AAC, plays everywhere), WebM (VP9 + Opus), and the audio track alone as MP3, M4A (AAC) or WAV.
- ✅ **Reads almost anything**: MP4, MOV, MKV, WebM, AVI, MPEG-TS, 3GP, FLV, WMV, MP3, M4A, WAV, FLAC, OGG and more, with H.264, HEVC, VP9, AV1, ProRes and most other codecs.
- ✅ **Target file size**: give a size in MB (e.g. 25 for Discord, 16 for WhatsApp) and get a file of about that size.
- ✅ **Resize**: 480p, 720p or 1080p, portrait or landscape, never enlarged. 4K and other inputs above 1080p are always brought down to 1080p or less.
- ✅ **Trim and mute**: keep a part of the file with a start time and a duration, or drop the audio track.
- ✅ **Batch-safe**: a 404, a web page, a corrupt file or an over-long video never fails the run. You get an item with the reason, for free.
- ✅ **Pay per output minute**: from $0.003 per audio minute and $0.008 per 480p video minute. No start fee.

## Start in one minute

Click **Start** with the prefilled input:

```json
{
  "outputFormat": "mp4",
  "maxHeight": 720
}
```

You get: With no file given, the actor generates a 3-second 320x240 test clip (colour bars and a 440 Hz tone, MPEG-4 video) with FFmpeg and converts it to an H.264 MP4: about 178 KB in, 67 KB out (63% saved), with `outputUrl`, `outputBytes` and `savedPercent`. Add your own links in **File URLs** to convert your files.

**Cost:** $0.008: 1 video minute × $0.008. No start fee.

## Use with an AI assistant

Connect the [Apify MCP server](https://mcp.apify.com) to Claude, ChatGPT, Cursor or any MCP client (`https://mcp.apify.com?tools=cprussin/media-converter` loads only this actor), then paste:

```text
Use the Apify actor cprussin/media-converter to compress https://example.com/videos/demo.mov to a 720p MP4 under 25 MB, and give me the download link and how much smaller it got.
```

## Recipes

### Compress a phone video to 25 MB

A 1080p or 4K phone video as a 720p MP4 of about 25 MB, small enough for Discord or email.

```json
{
  "urls": ["https://example.com/videos/holiday.mov"],
  "outputFormat": "mp4",
  "maxHeight": 720,
  "targetMb": 25
}
```

### WebM for a website

VP9 WebM at 720p for a site or player that wants WebM, at a slightly lower quality to keep the files small.

```json
{
  "urls": [
    "https://example.com/videos/hero.mp4",
    "https://example.com/videos/product-tour.mp4"
  ],
  "outputFormat": "webm",
  "maxHeight": 720,
  "crf": 28
}
```

### Extract the audio as MP3

The audio track of a recorded talk or video podcast as an MP3, billed as audio minutes.

```json
{
  "urls": ["https://example.com/recordings/webinar.mp4"],
  "outputFormat": "mp3"
}
```

### Trim a silent 30-second clip

30 seconds starting at 1:00, with the audio removed, as a 480p MP4.

```json
{
  "urls": ["https://example.com/videos/screen-recording.mp4"],
  "outputFormat": "mp4",
  "maxHeight": 480,
  "startSeconds": 60,
  "durationSeconds": 30,
  "mute": true
}
```

### Your own uploads to 1080p MP4

Files uploaded to an Apify key-value store, converted to H.264 MP4 at up to 1080p.

```json
{
  "keyValueStoreRecords": ["my-user~videos/interview.mkv"],
  "outputFormat": "mp4",
  "maxHeight": 1080,
  "crf": 21
}
```

## What can I use a video converter for?

- **Sharing**: get a video under the size limit of Discord, WhatsApp, Slack, email or a form upload.
- **Websites**: turn MOV, MKV or huge camera files into small MP4 or WebM files that play in every browser.
- **Storage costs**: re-encode old archives to H.264 at 720p or 1080p and save most of the space.
- **Audio extraction**: pull the soundtrack of a video as MP3, M4A or WAV for podcasts, transcription or editing.
- **Clips**: cut a part of a long recording without opening an editor.
- **Automation and AI agents**: add a "convert this video" step to Make, Zapier, n8n or an MCP-enabled agent through the Apify API.

## How does it work?

1. Each file is downloaded (with size and time limits) or read from your key-value store. Private and internal network addresses are refused.
2. FFprobe reads the container, codecs, resolution, duration and bitrate. Web pages, images, streaming playlists and over-long files are skipped (free).
3. FFmpeg decodes the file and, for video, scales it to fit the resolution you chose (rotation applied, never enlarged).
4. It encodes H.264 with x264 (`veryfast` preset) or VP9 with libvpx (realtime mode), and AAC, Opus, MP3 or PCM audio. With **Target file size**, the bitrate is set from the length, and the file is encoded once more if the first pass misses by more than 5%.
5. FFprobe checks the output, the file is saved to the run's key-value store, and the dataset item gets the link, both sides' codecs, resolution, duration and bitrate, and the percentage saved.

## How do I convert a video?

| Field                  | Description                                                               | Default     |
| ---------------------- | ------------------------------------------------------------------------- | ----------- |
| `urls`                 | Direct links to video or audio files, one per line                        | a test clip |
| `startUrls`            | Same, in Apify request-list format (combined with `urls`)                 | none        |
| `keyValueStoreRecords` | Uploaded files, as `storeId/recordKey` or `username~store-name/recordKey` | none        |
| `outputFormat`         | `mp4`, `webm`, `mp3`, `m4a` or `wav`                                      | `mp4`       |
| `maxHeight`            | Max resolution: `480`, `720` or `1080` (the shorter side, in pixels)      | `1080`      |
| `crf`                  | Video quality, 10-45: lower is better and bigger                          | `23`        |
| `targetMb`             | Target file size in MB instead of a fixed quality                         | none        |
| `startSeconds`         | Start the output this many seconds into the file                          | `0`         |
| `durationSeconds`      | Keep only this many seconds                                               | to the end  |
| `mute`                 | Remove the audio track (MP4 and WebM)                                     | `false`     |
| `maxDurationMinutes`   | Longer outputs are skipped with a free error (1-180)                      | `30`        |
| `maxFileSizeMb`        | Larger downloads are skipped with a free error (1-4000)                   | `1000`      |
| `timeoutSecs`          | Max download time per file                                                | `600`       |

**Converting your own files:** upload them to a key-value store in your Apify account (Storage → Key-value stores → your store → upload a record) and list them in `keyValueStoreRecords`, e.g. `my-user~videos/interview.mkv`. Private record URLs (`https://api.apify.com/v2/key-value-stores/.../records/...`) also work in `urls`; the actor reads them with your run's token.

**Platform links (YouTube, TikTok, Instagram, Facebook, X, Vimeo, Twitch, SoundCloud and others) are refused** with a free error item. This actor converts files you have the rights to, from a direct file link or an upload; it doesn't download from video platforms.

## What data do you get?

One item per file:

```json
{
  "url": "sample-320x240-3s.mp4",
  "sourceType": "sample",
  "fileName": "sample-320x240-3s.mp4",
  "inputBytes": 177872,
  "inputContainer": "mov,mp4,m4a,3gp,3g2,mj2",
  "inputVideoCodec": "mpeg4",
  "inputAudioCodec": "aac",
  "inputWidth": 320,
  "inputHeight": 240,
  "inputDurationSeconds": 3,
  "inputBitrate": 474325,
  "outputFormat": "mp4",
  "outputVideoCodec": "h264",
  "outputAudioCodec": "aac",
  "outputWidth": 320,
  "outputHeight": 240,
  "outputDurationSeconds": 3.018,
  "outputBitrate": 176527,
  "outputBytes": 66595,
  "savedPercent": 62.6,
  "crf": 23,
  "targetMb": null,
  "outputKey": "converted-0001-sample-320x240-3s.mp4",
  "outputUrl": "https://api.apify.com/v2/key-value-stores/.../records/converted-0001-sample-320x240-3s.mp4",
  "chargedEvent": "video-480p-minute",
  "chargedMinutes": 1,
  "processingSeconds": 0.4,
  "warning": null,
  "error": null,
  "convertedAt": "2026-11-17T07:00:00.000Z"
}
```

- The converted files are in the run's key-value store as `converted-0001-<name>.<format>`, linked from every item. They are kept only as long as Apify keeps the run's storage (its data retention period), so download what you want to keep.
- Bitrates are in bits per second. `savedPercent` compares the output with the downloaded file; it is negative when the output is bigger (e.g. a well-compressed MP3 saved as WAV).
- Failed files are returned with an `error` and no output, such as `Download failed: HTTP 404.`, `This link is a web page, not a media file.` or `The output would be 42.0 min long, over the 30 min limit (maxDurationMinutes).`
- `warning` notes things like a silent input, a target size that couldn't be reached, or an input above 1080p billed as 1080p.

## How much does video conversion cost?

Pay per event: **one event per started minute of output**, by the output's resolution. No subscription, no start fee, compute included:

| Output                              | Event                | Price per minute |
| ----------------------------------- | -------------------- | ---------------- |
| MP3, M4A or WAV audio               | `audio-minute`       | **$0.003**       |
| MP4 or WebM up to 480p (854x480)    | `video-480p-minute`  | **$0.008**       |
| MP4 or WebM up to 720p (1280x720)   | `video-720p-minute`  | **$0.02**        |
| MP4 or WebM up to 1080p (1920x1080) | `video-1080p-minute` | **$0.04**        |

- Each file is billed with exactly one of these events, times its minutes: a 10-minute video converted to a 720p MP4 costs 10 × $0.02 = $0.20; its audio as an MP3 costs 10 × $0.003 = $0.03.
- Minutes count the **output** length, so trimming lowers the price. They are rounded up with a 1-second grace: 61 s is 1 minute, 1 min 2 s is 2.
- **Inputs above 1080p** (1440p, 4K) are always scaled to 1080p or less, and their video outputs are billed as `video-1080p-minute` whatever the output resolution, because decoding them costs as much as encoding 1080p. The item's `warning` says so.
- Failed and skipped files are free. If you set a **maximum cost per run**, the actor never converts a file the remaining budget can't pay for: it skips it with a free error item and moves on to shorter files.

## Tips

- **Quality**: the default CRF 23 looks close to the original at a fraction of the size. Use 18-20 for archiving, 26-30 for small sharing copies. Lowering the resolution saves more than raising the CRF.
- **Target size**: aim a little under a hard limit (e.g. 24 for a 25 MB limit). Very small targets for long videos look blurry; the item warns when a target is too small to reach.
- **MP4 or WebM**: MP4 (H.264) plays on every phone, TV and browser, and is the better choice for compression. WebM (VP9) is for pages and players that need it; it is encoded in VP9's fast realtime mode, which at the same CRF looks about the same as the MP4 but was about 2x larger in our tests.
- **Speed**: in our tests on one CPU core, a minute of 1080p phone video took about 25 s to convert to a 720p MP4, 50-60 s to 1080p and 17 s to 480p, and a minute of 4K about 40 s to 480p; extracting audio takes about a second. The default 4 GB of memory gives one core; 1 GB gets a quarter of one (4x slower, same price per minute), and 8 GB or more gives FFmpeg two or more threads.
- **Audio**: audio with more than two channels (5.1) is downmixed to stereo. MP4 audio is AAC at 128 kbit/s, WebM Opus at 96 kbit/s, M4A AAC at 160 kbit/s, MP3 VBR at about 190 kbit/s and WAV 16-bit PCM at the source sample rate.

## FAQ

**Which files can't it read?** Encrypted (DRM) files, streaming playlists (`.m3u8`, `.mpd`), web pages with an embedded player, and files over the size limit. Use the direct link to the complete file.

**Does it keep HDR?** No. 10-bit and HDR video is converted to standard 8-bit H.264 or VP9 without tone mapping, so HDR footage can look washed out.

**Are my files sent anywhere else?** No. Everything runs inside the actor's container on Apify. The converted files stay in your run's key-value store.

**Can it download YouTube or TikTok videos?** No. Platform links are refused; convert files you have the rights to.

**Can AI agents use it?** Yes, through the Apify API, the Apify MCP server or any Apify integration (Make, Zapier, n8n, LangChain).

**Disclaimer:** You are responsible for having the right to process the files you submit.

## Open-source software

This actor runs [FFmpeg](https://ffmpeg.org/) 7.1, built from the official source with [x264](https://www.videolan.org/developers/x264.html) for H.264, which makes this FFmpeg build GPL-2.0-or-later, plus [libvpx](https://www.webmproject.org/) (BSD) for VP9, [libopus](https://opus-codec.org/) (BSD), [LAME](https://lame.sourceforge.io/) (LGPL) and [dav1d](https://code.videolan.org/videolan/dav1d) (BSD). FFmpeg runs as a separate program. See `THIRD_PARTY_NOTICES.md` in the source for all notices and where to get the source code. It is not affiliated with or endorsed by these projects.

## Related actors

- [Video Frame Extractor](https://apify.com/cprussin/video-frame-extractor?fpr=to54nm): Thumbnails, scene keyframes, contact sheets and GIFs from video files.
- [Whisper Audio & Video Transcriber](https://apify.com/cprussin/media-transcriber?fpr=to54nm): Audio, video and podcast transcription with Whisper, with SRT and VTT subtitles.
- [Image Converter & Compressor](https://apify.com/cprussin/image-converter?fpr=to54nm): Convert and compress images to WebP, AVIF, JPEG or PNG.
