# Video Frame Extractor: Thumbnails, Scene Keyframes, Contact Sheet & GIF

**Video Frame Extractor** turns video files into **still images**: a frame **every N seconds**, **N evenly spaced thumbnails**, or one **keyframe per scene change**. Add a **contact sheet** (one grid image of all frames), the **video metadata** (duration, resolution, FPS, codecs), the **audio track** as M4A, MP3 or Opus, and a short **animated GIF clip**, all in one run. Paste direct video links or point it at your own uploads. Everything runs with FFmpeg inside the actor: **no API key, no external service**.

- ✅ **Interval frames**: one every N seconds, or exactly N frames spread over the whole video.
- ✅ **Scene-change keyframes**: one frame at the start of each shot, with adjustable sensitivity and minimum scene length.
- ✅ **JPEG, PNG or WebP**, with quality and max width; frames are saved upright (phone rotation applied).
- ✅ **Contact sheet**, **GIF clip** and **audio track** (M4A, MP3, Opus; copied without re-encoding when it is already in that codec) as optional extras.
- ✅ **Video metadata** for every file: duration, width, height, FPS, video and audio codecs, bit rate, rotation, audio channels.
- ✅ **Any common video**: MP4, MOV, MKV, WEBM, AVI, MPEG-TS, FLV, 3GP; H.264, HEVC, VP8/VP9, AV1, ProRes and more.
- ✅ **Batch-safe**: a 404, a web page, a corrupt or too-long file never fails the run. You get an item with the reason, for free.
- ✅ **Pay per result**: $0.005 per video + $0.003 per frame. No start fee, compute included.

## What can I use a video frame extractor for?

- **Thumbnails and previews**: pick cover images for a video library, CMS or e-commerce product videos.
- **AI and computer vision**: feed frames to a vision model (GPT-4o, Claude, Gemini) for captioning, tagging, moderation or search.
- **Video summaries**: one keyframe per scene gives a storyboard of a talk, ad or tutorial; the contact sheet shows it at a glance.
- **Datasets**: sample frames from your own footage for training or labeling.
- **Social content**: grab stills and a GIF from your own clips, and the audio track for a podcast or transcript.
- **Automation and AI agents**: add a "get frames from this video" step to Make, Zapier, n8n or an MCP-enabled agent through the Apify API.

## How does it work?

1. Each video is downloaded (with size and time limits), or read from your key-value store. Web pages, streaming playlists and social links are refused for free.
2. FFprobe reads the metadata. Videos over **Max video length** are skipped (free).
3. **Interval mode** seeks straight to each timestamp, so only a few frames are decoded per image. **Scene mode** decodes the whole video at low resolution and measures how much each frame differs from the previous one (FFmpeg's scene score); a jump over the threshold starts a new scene.
4. Frames are scaled to **Max width** and saved as JPEG, PNG or WebP in the run's key-value store. The contact sheet, GIF and audio track are made from the same video.
5. One dataset item per video lists every frame (time, timecode, link, size), the extras and the metadata.

## How do I extract frames from a video?

| Field                                                                    | Description                                                                  | Default            |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------ |
| `urls`                                                                   | Direct links to video files, one per line                                    | a NASA video       |
| `startUrls`                                                              | Same, in Apify request-list format (combined with `urls`)                    | none               |
| `keyValueStoreRecords`                                                   | Uploaded videos, as `storeId/recordKey` or `username~store-name/recordKey`   | none               |
| `mode`                                                                   | `interval`, `scene` (scene changes) or `none` (metadata, GIF and audio only) | `interval`         |
| `intervalSeconds`                                                        | Interval mode: one frame every N seconds from 0:00                           | `10`               |
| `frameCount`                                                             | Interval mode: N evenly spaced frames instead (0: use `intervalSeconds`)     | `0`                |
| `sceneThreshold`                                                         | Scene mode: sensitivity, 1-99 (lower finds more cuts)                        | `30`               |
| `minSceneSeconds`                                                        | Scene mode: ignore cuts closer than this to the previous one                 | `1`                |
| `maxFrames`                                                              | Max frames per video (at most 1000)                                          | `50`               |
| `frameFormat`                                                            | `jpg`, `png` or `webp`                                                       | `jpg`              |
| `frameQuality`                                                           | JPEG/WebP quality, 1-100                                                     | `85`               |
| `maxWidth`                                                               | Scale wider frames down to this width (0: original size)                     | `1280`             |
| `contactSheet`, `contactSheetColumns`                                    | Also save a grid image of the frames, with this many columns                 | off, `4`           |
| `gifClip`, `gifStartSeconds`, `gifDurationSeconds`, `gifWidth`, `gifFps` | Also save an animated GIF clip (at most 15 s)                                | off, 0, 5, 480, 10 |
| `audioFormat`                                                            | Also save the audio track: `none`, `m4a`, `mp3` or `opus`                    | `none`             |
| `maxDurationMinutes`                                                     | Longer videos are skipped with a free error (at most 180)                    | `60`               |
| `maxFileSizeMb`                                                          | Larger downloads are skipped with a free error (at most 4000)                | `1000`             |
| `timeoutSecs`                                                            | Max download time per video                                                  | `600`              |

Example: 12 thumbnails and a contact sheet from two product videos, as WebP:

```json
{
  "urls": [
    "https://example.com/videos/product-demo.mp4",
    "https://example.com/videos/unboxing.mov"
  ],
  "frameCount": 12,
  "frameFormat": "webp",
  "maxWidth": 960,
  "contactSheet": true
}
```

Example: one keyframe per scene plus the audio track as MP3:

```json
{
  "urls": ["https://example.com/talks/keynote.mp4"],
  "mode": "scene",
  "sceneThreshold": 35,
  "maxFrames": 100,
  "audioFormat": "mp3"
}
```

**Processing your own files:** upload them to a key-value store in your Apify account (Storage → Key-value stores → your store → upload a record) and list them in `keyValueStoreRecords`, e.g. `my-user~videos/demo.mp4`. Private record URLs (`https://api.apify.com/v2/key-value-stores/.../records/...`) also work in `urls`; the actor reads them with your run's token.

**YouTube, TikTok, Instagram, Facebook, X, Vimeo, Twitch and other social or video-platform links are refused** with a free error item, as are web pages and streaming playlists (`.m3u8`, `.mpd`). Use a direct link to a video file you have the rights to.

## What data do you get?

One item per video (shortened):

```json
{
  "url": "https://images-assets.nasa.gov/video/KSC_69-71212-sRGB/KSC_69-71212-sRGB~small.mp4",
  "sourceType": "url",
  "fileName": "KSC_69-71212-sRGB~small.mp4",
  "bytes": 15526635,
  "mode": "interval",
  "durationSeconds": 84.2,
  "width": 480,
  "height": 480,
  "fps": 30,
  "videoCodec": "h264",
  "audioCodec": null,
  "container": "mov,mp4,m4a,3gp,3g2,mj2",
  "bitRate": 1475214,
  "rotation": 0,
  "hasAudio": false,
  "frameFormat": "jpg",
  "frameCount": 12,
  "frames": [
    {
      "index": 1,
      "timeSeconds": 3.508,
      "timecode": "00:00:03.508",
      "sceneScore": null,
      "key": "video-0001-frame-0001.jpg",
      "url": "https://api.apify.com/v2/key-value-stores/.../records/video-0001-frame-0001.jpg",
      "width": 480,
      "height": 480,
      "bytes": 18446
    }
  ],
  "frameUrls": [
    "https://api.apify.com/v2/key-value-stores/.../records/video-0001-frame-0001.jpg"
  ],
  "contactSheetUrl": "https://api.apify.com/v2/key-value-stores/.../records/video-0001-contact-sheet.jpg",
  "gifUrl": "https://api.apify.com/v2/key-value-stores/.../records/video-0001-clip.gif",
  "audioUrl": null,
  "charges": { "video-processed": 1, "frame": 13, "audio-or-gif": 1 },
  "costUsd": 0.049,
  "warning": null,
  "error": null
}
```

- Files are in the run's key-value store as `video-0001-frame-0001.jpg`, `video-0001-contact-sheet.jpg`, `video-0001-clip.gif` and `video-0001-audio.m4a` (numbered by input order), linked from every item.
- In scene mode, `sceneCount` is the number of scenes found and each frame has its `sceneScore` (0-1; 1 for the first frame).
- Failed videos are returned with an `error` and no files, such as `Download failed: HTTP 404.`, `This link is a web page, not a video file.`, `The video is 75.3 min long, over the 60 min limit (maxDurationMinutes).` or `The file has no video track (it is audio only).`
- `warning` notes things like frames capped by `maxFrames`, a frame that could not be decoded or a video without audio.

## How much does video frame extraction cost?

Pay per event, compute included, no start fee:

| Event             | Price      | When                                                              |
| ----------------- | ---------- | ----------------------------------------------------------------- |
| `video-processed` | **$0.005** | Each video delivered (metadata included). Failed videos are free. |
| `frame`           | **$0.003** | Each frame image. A contact sheet counts as one frame.            |
| `scene-minute`    | **$0.01**  | Scene mode only: each started minute of video analyzed.           |
| `audio-or-gif`    | **$0.005** | The audio track copied as is, or each GIF unit (see below).       |
| `audio-minute`    | **$0.002** | Each started minute of video when the audio track is re-encoded.  |

- **Larger videos** take longer to decode: above 1080p, scene minutes and GIF events count once per 1080p-sized area (1440p 2x, 4K 4x).
- **GIF clip**: one event per 5 s of a 480x480 px, 10 fps clip, so the default clip (5 s, 480 px wide, 10 fps) of a landscape video is 1 event; a 15 s, 1080 px, 25 fps clip is 22.
- **Audio track**: copied for a flat $0.005 when it is already in the chosen codec (AAC for M4A, MP3 for MP3, Opus for Opus); otherwise re-encoded for $0.002 per started minute.

Examples:

| Run                                          | Price      |
| -------------------------------------------- | ---------- |
| 1 video, 12 thumbnails                       | **$0.041** |
| 1 video, 12 thumbnails + contact sheet + GIF | **$0.049** |
| 10 min video, scene mode, 25 keyframes       | **$0.18**  |
| Same 10 min video in 4K                      | **$0.48**  |
| 1 video, metadata + audio track copied (M4A) | **$0.01**  |
| 60 min video, audio re-encoded to MP3        | **$0.125** |

If you set a **maximum cost per run**, the actor never starts work it can't pay for: a video whose frames, scene minutes or extras don't fit the remaining budget is skipped with a free error item, and scene mode keeps only the strongest cuts the budget pays for.

## Tips

- **Speed**: on the default 4 GB memory (1 CPU core), 24 frames from a 2-minute 720p video take about 12 s; scene detection takes about 5 s per minute of 720p video and 9 s per minute of 1080p, plus the download. The audio track is copied in seconds when it is already in the chosen codec (e.g. AAC in an MP4, for M4A); re-encoding takes about 1 s per minute.
- **Choose a mode**: interval mode is fastest and cheapest for thumbnails. Scene mode suits edited videos (ads, talks, trailers); for one-shot footage (a webcam, a launch) it finds few scenes.
- **Sensitivity**: if scene mode finds too many frames (flicker, fast motion), raise `sceneThreshold` or `minSceneSeconds`; if it misses soft cuts or fades, lower the threshold to 15-20.
- **File size**: JPEG at quality 85 is a good default; WebP is about 30% smaller; PNG is lossless and several times larger.
- **Long videos**: the default limit is 60 minutes (180 at most). Interval mode spreads `maxFrames` over the whole video when more frames would be needed.

## FAQ

**Can I extract frames from YouTube or TikTok videos?** No. Social and video-platform links are refused: downloading from them breaks their terms of service. Use direct links to video files you own or have the rights to, or upload them to a key-value store.

**Which codecs are supported?** Everything FFmpeg 7.1 decodes natively: H.264, HEVC/H.265, VP8, VP9, AV1, MPEG-2, MPEG-4, ProRes, DNxHD, MJPEG and many more, in MP4, MOV, MKV, WEBM, AVI, TS and other containers.

**Are my videos sent anywhere else?** No. Everything runs inside the actor's container on Apify.

**Can AI agents use it?** Yes, through the Apify API, the Apify MCP server or any Apify integration (Make, Zapier, n8n, LangChain).

**Disclaimer:** You are responsible for having the right to process the videos you submit.

## Open-source software

This actor runs [FFmpeg](https://ffmpeg.org/) 7.1 in an LGPL build compiled from the official source, with [dav1d](https://code.videolan.org/videolan/dav1d) (BSD), [libwebp](https://chromium.googlesource.com/webm/libwebp) (BSD), [libopus](https://opus-codec.org/) (BSD) and [LAME](https://lame.sourceforge.io/) (LGPL). See `THIRD_PARTY_NOTICES.md` in the source for all notices. It is not affiliated with or endorsed by the FFmpeg project.

## Related actors

- [media-transcriber](https://apify.com/cprussin/media-transcriber?fpr=to54nm): Audio, video and podcast transcription with Whisper, with SRT and VTT subtitles.
- [image-upscaler](https://apify.com/cprussin/image-upscaler?fpr=to54nm): Upscale and enhance images 2x-4x with Real-ESRGAN.
- [website-screenshot](https://apify.com/cprussin/website-screenshot?fpr=to54nm): Full-page or viewport screenshots and PDFs of any URL.
