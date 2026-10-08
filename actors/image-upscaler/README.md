# AI Image Upscaler: Real-ESRGAN 2x, 3x, 4x Photo Enhancer

**AI Image Upscaler** makes images **2x, 3x or 4x larger and sharper** with **Real-ESRGAN**, the open-source super-resolution model. It removes blur, JPEG blocks and noise while it enlarges: good for **photos, product shots, old scans, screenshots, thumbnails and AI-generated art**. Paste image links or point it at your own uploads, and get **PNG, JPEG or WebP** files with a link for each. The model runs inside the actor: **no API key, no GPU service, no per-call fees** to anyone else.

- ✅ **2x, 3x or 4x** upscaling with Real-ESRGAN (`realesr-general-x4v3`), tile by tile so large images fit in memory.
- ✅ **Any common image**: JPEG, PNG, WebP, GIF, BMP, TIFF and AVIF. EXIF rotation is applied, transparency and grayscale are kept.
- ✅ **PNG, JPEG or WebP output** with adjustable quality, saved in the run's key-value store with a public link.
- ✅ **Your own files**: upload images to an Apify key-value store and list them; no hosting needed.
- ✅ **Batch-safe**: a 404, a web page, a corrupt file or an over-size image never fails the run. You get an item with the reason, for free.
- ✅ **Pay per image**: $0.01 per image up to 0.5 MP (e.g. 800x600), $0.02 up to 1 MP, $0.04 up to 2 MP. Same price at 2x, 3x and 4x. No start fee.

## What can I use an AI image upscaler for?

- **E-commerce**: enlarge small supplier or marketplace product photos for zoom views and print.
- **Old photos and scans**: sharpen low-resolution family photos, archive scans and document images.
- **AI art and design**: upscale Stable Diffusion, Midjourney or DALL-E outputs for prints, wallpapers and thumbnails.
- **Web and social content**: turn small logos, screenshots and thumbnails into crisp large images.
- **Automation and AI agents**: add an "upscale this image" step to Make, Zapier, n8n or an MCP-enabled agent through the Apify API.

## How does it work?

1. Each image is downloaded (with size and time limits), or read from your key-value store.
2. The format is checked from the file's first bytes; the size is read from its header. Images over **Max input size** are skipped (free).
3. [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) upscales the image 4x on CPU with ONNX Runtime, in overlapping 512 px tiles so seams don't show. For 2x and 3x the 4x result is resized down with Lanczos filtering (sharper than running a 2x model).
4. The result is encoded as PNG, JPEG or WebP and saved to the run's key-value store. The dataset item has the link, input and output sizes and the processing time.

## How do I upscale images?

| Field                  | Description                                                                | Default      |
| ---------------------- | -------------------------------------------------------------------------- | ------------ |
| `urls`                 | Direct links to images, one per line                                       | a NASA photo |
| `startUrls`            | Same, in Apify request-list format (combined with `urls`)                  | none         |
| `keyValueStoreRecords` | Uploaded images, as `storeId/recordKey` or `username~store-name/recordKey` | none         |
| `scale`                | `2`, `3` or `4`                                                            | `4`          |
| `outputFormat`         | `png` (lossless, transparency), `jpg` (small) or `webp` (smallest)         | `png`        |
| `quality`              | JPEG/WebP quality, 1-100                                                   | `90`         |
| `maxInputMegapixels`   | `0.25`, `0.5`, `1` or `2`: larger images are skipped with a free error     | `2`          |
| `maxFileSizeMb`        | Larger downloads are skipped with a free error (at most 100)               | `25`         |
| `timeoutSecs`          | Max download time per image                                                | `60`         |

Example: upscale two product photos 2x to JPEG:

```json
{
  "urls": [
    "https://example.com/products/shoe-small.jpg",
    "https://example.com/products/bag-small.png"
  ],
  "scale": 2,
  "outputFormat": "jpg",
  "quality": 92
}
```

**Upscaling your own files:** upload them to a key-value store in your Apify account (Storage → Key-value stores → your store → upload a record) and list them in `keyValueStoreRecords`, e.g. `my-user~photos/scan-001.jpg`. Private record URLs (`https://api.apify.com/v2/key-value-stores/.../records/...`) also work in `urls`; the actor reads them with your run's token.

**Social-network links (Instagram, Facebook, TikTok, X, Pinterest, LinkedIn) are refused** with a free error item: upscale images you have the rights to.

## What data do you get?

One item per image (shortened):

```json
{
  "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Aldrin_Apollo_11_original.jpg/500px-Aldrin_Apollo_11_original.jpg",
  "sourceType": "url",
  "fileName": "Aldrin_Apollo_11_original.jpg",
  "inputFormat": "jpg",
  "inputWidth": 500,
  "inputHeight": 503,
  "inputMegapixels": 0.25,
  "scale": 4,
  "outputWidth": 2000,
  "outputHeight": 2012,
  "outputFormat": "png",
  "outputBytes": 5189662,
  "outputKey": "upscaled-0001-Aldrin_Apollo_11_original.png",
  "outputUrl": "https://api.apify.com/v2/key-value-stores/.../records/upscaled-0001-Aldrin_Apollo_11_original.png",
  "model": "realesr-general-x4v3",
  "billedUnits": 1,
  "processingSeconds": 8.72,
  "warning": null,
  "error": null,
  "upscaledAt": "2026-10-08T07:00:00.000Z"
}
```

- The upscaled files are in the run's key-value store as `upscaled-0001-<name>.<format>`, linked from every item.
- Failed images are returned with an `error` and no output, such as `Download failed: HTTP 404.`, `This link is a web page, not an image.`, `The image is 2000x1500 (3 MP), over the 2 MP input limit (maxInputMegapixels).` or `HEIC/HEIF images (iPhone photos) are not supported.`
- `warning` notes things like an animated GIF (only the first frame is upscaled) or transparency flattened for JPEG.

## How much does image upscaling cost?

Pay per event, by the size of the **input** image. No subscription, no start fee, compute included:

| Input size                | Example sizes             | Price per image |
| ------------------------- | ------------------------- | --------------- |
| up to 0.5 MP              | 640x480, 800x600, 700x700 | **$0.01**       |
| 0.5 to 1 MP               | 1024x768, 1280x720        | **$0.02**       |
| 1 to 1.5 MP               | 1280x1024, 1440x900       | **$0.03**       |
| 1.5 to 2 MP (the maximum) | 1600x1200, 1920x1040      | **$0.04**       |

That is one `image-upscaled` event ($0.01) per started 0.5 megapixel of input. The scale and output format don't change the price. Failed and skipped images are free. If you set a **maximum cost per run**, the actor never upscales an image the remaining budget can't pay for: it skips it with a free error item and moves on to smaller images.

## Tips

- **Speed**: on the default 4 GB memory (1 CPU core), a 0.5 MP image takes about 15-20 s and a 2 MP image about a minute. More memory gives more cores (4 GB per core) and faster images; the price per image stays the same.
- **Output size**: 4x of a 2 MP image is 32 MP (e.g. 6528x4900). As PNG that is often 25 MB or more; use `jpg` or `webp` for smaller files. WebP allows at most 16383 px per side.
- **Bigger inputs**: images over 2 MP are already large; downscale them first if you really need to upscale them.
- **Faces**: Real-ESRGAN is a general model. It sharpens faces but doesn't reconstruct facial detail like dedicated face-restoration models do.

## FAQ

**Which model does it use?** Real-ESRGAN `realesr-general-x4v3` (BSD-3-Clause), a compact general-purpose model trained to remove real-world blur, noise and compression artifacts while upscaling. It runs on CPU with ONNX Runtime. Larger Real-ESRGAN models (x4plus) were measured at about 12x the CPU time for a modest quality gain, so they aren't offered.

**Is there a face-enhancement option?** No. The popular face models (GFPGAN, CodeFormer) are under licenses or trained on data that don't allow commercial use, so they aren't included.

**Are my images sent to an AI provider?** No. Everything runs inside the actor's container on Apify.

**Can AI agents use it?** Yes, through the Apify API, the Apify MCP server or any Apify integration (Make, Zapier, n8n, LangChain).

**Disclaimer:** You are responsible for having the right to process the images you submit.

## Open-source software

This actor runs [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) model weights (BSD-3-Clause) with [ONNX Runtime](https://github.com/microsoft/onnxruntime) (MIT) and [Pillow](https://python-pillow.org/) (MIT-CMU). See `THIRD_PARTY_NOTICES.md` in the source for all notices. It is not affiliated with or endorsed by the Real-ESRGAN authors, Tencent ARC or Microsoft.

## Related actors

- [website-screenshot](https://apify.com/cprussin/website-screenshot?fpr=to54nm): Full-page or viewport screenshots and PDFs of any URL.
- [document-to-markdown](https://apify.com/cprussin/document-to-markdown?fpr=to54nm): PDF, Word, PowerPoint, Excel and EPUB to Markdown or RAG chunks.
- [media-transcriber](https://apify.com/cprussin/media-transcriber?fpr=to54nm): Audio, video and podcast transcription with Whisper, with SRT and VTT subtitles.
