# Image Converter & Compressor: WebP, AVIF, JPEG, PNG

**Image Converter & Compressor** turns images into **WebP, AVIF, JPEG or PNG** files, smaller and ready for the web. Resize them, pick a quality or a **target file size in KB**, and strip EXIF metadata (camera details, GPS location) in the same pass. Paste image links, point it at your own uploads, or feed it the image field of another actor's dataset, and get a download link for each file with the bytes saved. It runs [sharp](https://sharp.pixelplumbing.com/) (libvips) inside the actor: **no API key, no external service**.

- ✅ **Four output formats**: WebP, AVIF, JPEG (mozjpeg) and PNG, with adjustable quality.
- ✅ **Many input formats**: JPEG, PNG, WebP, AVIF, GIF, TIFF, BMP, **HEIC/HEIF (iPhone photos)** and SVG.
- ✅ **Target file size**: give a size in KB and get the highest quality that fits.
- ✅ **Resize**: max width and height with inside, cover (crop), contain (pad), fill or outside fit. Images are never enlarged.
- ✅ **Privacy**: EXIF, GPS, XMP and ICC metadata removed by default, after the EXIF rotation is applied.
- ✅ **Three input sources**: URLs, Apify key-value store uploads, or a field of any Apify dataset (e.g. a product scraper's image URLs).
- ✅ **Batch-safe**: a 404, a web page, a corrupt file or an over-size image never fails the run. You get an item with the reason, for free.
- ✅ **Pay per image**: $0.002 per image up to 12 MP, $0.004 above. No start fee.

## Start in one minute

Click **Start** with the prefilled input:

```json
{
  "outputFormat": "webp",
  "quality": 80
}
```

You get: With no image given, the actor generates a 640x480 test PNG and converts it to WebP: 40,428 bytes in, 11,368 bytes out (71.9% saved), with `outputUrl`, `outputBytes` and `savedPercent`. Add your own links in **Image URLs** to convert your images.

**Cost:** $0.002: 1 image × $0.002. No start fee.

## Use with an AI assistant

Connect the [Apify MCP server](https://mcp.apify.com) to Claude, ChatGPT, Cursor or any MCP client (`https://mcp.apify.com?tools=cprussin/image-converter` loads only this actor), then paste:

```text
Use the Apify actor cprussin/image-converter to convert https://example.com/photos/team.jpg to WebP at most 1600 px wide and under 200 KB, and give me the download link and how much smaller it got.
```

## Recipes

### Web-ready WebP, 1600 px wide

Shrink large photos for a website: WebP at quality 80, at most 1600 px wide.

```json
{
  "urls": [
    "https://example.com/photos/hero.jpg",
    "https://example.com/photos/team.png"
  ],
  "outputFormat": "webp",
  "quality": 80,
  "maxWidth": 1600
}
```

### AVIF under 100 KB

The smallest files: the highest AVIF quality (up to 85) that fits in 100 KB.

```json
{
  "urls": ["https://example.com/photos/hero.jpg"],
  "outputFormat": "avif",
  "quality": 85,
  "targetKb": 100
}
```

### iPhone HEIC photos to JPEG

HEIC uploads from your key-value store as JPEGs that open everywhere, with the GPS location removed.

```json
{
  "keyValueStoreRecords": ["my-user~photos/IMG_0001.HEIC"],
  "outputFormat": "jpeg",
  "quality": 90,
  "stripMetadata": true
}
```

### Product images from a scraper's dataset

Convert the image URLs in another run's dataset to square 800x800 WebP thumbnails.

```json
{
  "datasetId": "YOUR_DATASET_ID",
  "imageField": "imageUrl",
  "outputFormat": "webp",
  "maxWidth": 800,
  "maxHeight": 800,
  "fit": "contain"
}
```

## What can I use an image converter for?

- **Website speed**: convert JPEG and PNG images to WebP or AVIF and resize them, for faster pages and better Core Web Vitals.
- **E-commerce**: turn supplier or scraped product photos into uniform, lightweight thumbnails for a catalogue or marketplace upload.
- **Upload limits**: get images under a size limit in KB for forms, CMSs, email and marketplaces that reject large files.
- **iPhone photos**: convert HEIC to JPEG or WebP for apps and websites that can't open HEIC.
- **Privacy**: remove EXIF metadata, including GPS location, before you publish photos.
- **Automation and AI agents**: add an "optimize this image" step to Make, Zapier, n8n or an MCP-enabled agent through the Apify API.

## How does it work?

1. Each image is downloaded (with size and time limits), read from your key-value store, or taken from a dataset field. Private and internal network addresses are refused.
2. The format is checked from the file's first bytes and the size from its header. Images over **Max input size** are skipped (free).
3. sharp (libvips) decodes the image and applies the EXIF rotation. HEIC is decoded by libheif's `heif-convert` first, BMP by a small built-in decoder.
4. The image is resized if you set a maximum, then encoded. With **Target file size**, the actor encodes it several times to find the highest quality that fits.
5. The file is saved to the run's key-value store. The dataset item has the link, input and output sizes and the percentage saved.

## How do I convert images?

| Field                  | Description                                                                | Default      |
| ---------------------- | -------------------------------------------------------------------------- | ------------ |
| `urls`                 | Direct links to images, one per line                                       | a test image |
| `startUrls`            | Same, in Apify request-list format (combined with `urls`)                  | none         |
| `keyValueStoreRecords` | Uploaded images, as `storeId/recordKey` or `username~store-name/recordKey` | none         |
| `datasetId`            | A dataset whose items hold image URLs                                      | none         |
| `imageField`           | The dataset field with the URL (string, array or `{ url }`; dot paths ok)  | `url`        |
| `outputFormat`         | `webp`, `avif`, `jpeg` or `png`                                            | `webp`       |
| `quality`              | 1-100 for WebP, AVIF and JPEG (PNG is lossless)                            | `80`         |
| `targetKb`             | Target file size in KB; the highest quality that fits is used              | none         |
| `maxWidth`/`maxHeight` | Shrink to fit these pixel limits (never enlarges)                          | none         |
| `fit`                  | `inside`, `cover`, `contain`, `fill` or `outside`                          | `inside`     |
| `stripMetadata`        | Remove EXIF, GPS, XMP and ICC metadata                                     | `true`       |
| `maxInputMegapixels`   | Larger images are skipped with a free error (1-100)                        | `50`         |
| `maxFileSizeMb`        | Larger downloads are skipped with a free error (1-200)                     | `50`         |
| `timeoutSecs`          | Max download time per image                                                | `60`         |

**Converting your own files:** upload them to a key-value store in your Apify account (Storage → Key-value stores → your store → upload a record) and list them in `keyValueStoreRecords`, e.g. `my-user~photos/IMG_0001.HEIC`. Private record URLs (`https://api.apify.com/v2/key-value-stores/.../records/...`) also work in `urls`; the actor reads them with your run's token.

**Social-network links (Instagram, Facebook, TikTok, X, Pinterest, LinkedIn) are refused** with a free error item: convert images you have the rights to.

## What data do you get?

One item per image:

```json
{
  "url": "sample-640x480.png",
  "sourceType": "sample",
  "fileName": "sample-640x480.png",
  "inputFormat": "png",
  "inputBytes": 40428,
  "inputWidth": 640,
  "inputHeight": 480,
  "inputMegapixels": 0.31,
  "outputFormat": "webp",
  "outputWidth": 640,
  "outputHeight": 480,
  "outputBytes": 11368,
  "savedPercent": 71.9,
  "quality": 80,
  "outputKey": "converted-0001-sample-640x480.webp",
  "outputUrl": "https://api.apify.com/v2/key-value-stores/.../records/converted-0001-sample-640x480.webp",
  "chargedEvent": "image-converted",
  "warning": null,
  "error": null,
  "convertedAt": "2026-11-17T07:00:00.000Z"
}
```

- The converted files are in the run's key-value store as `converted-0001-<name>.<format>`, linked from every item.
- `savedPercent` compares the output with the downloaded file; it is negative when the output is bigger (e.g. a small JPEG saved as lossless PNG).
- Failed images are returned with an `error` and no output, such as `Download failed: HTTP 404.`, `This link is a web page, not an image.` or `The image is 9000x7000 (63 MP), over the 50 MP input limit (maxInputMegapixels).`
- `warning` notes things like an animated GIF (only the first frame is converted), transparency flattened for JPEG, or a target size that couldn't be reached.

## How much does image conversion cost?

Pay per event, by the size of the **input** image. No subscription, no start fee, compute included:

| Input size  | Example sizes        | Event                   | Price per image |
| ----------- | -------------------- | ----------------------- | --------------- |
| up to 12 MP | 1920x1080, 4000x3000 | `image-converted`       | **$0.002**      |
| over 12 MP  | 6000x4000, 8192x5464 | `image-converted-large` | **$0.004**      |

That is $2 per 1,000 images up to 12 MP. The output format, quality, target size and resizing don't change the price. Failed and skipped images are free. If you set a **maximum cost per run**, the actor never converts an image the remaining budget can't pay for: it skips it with a free error item and moves on to smaller images. Set `maxInputMegapixels` to `12` to make sure no image costs more than $0.002.

## Tips

- **Format choice**: WebP is the safe default for the web. AVIF is usually smaller at the same visual quality but slower to encode; all current major browsers display it. Use JPEG for email and older software, PNG for screenshots, logos and pixel-exact output.
- **Speed**: in our tests a 12 MP photo took about 1 s of CPU time for WebP, AVIF or JPEG. The default 1 GB of memory gets a quarter of a CPU core, so that is about 4 s per image; more memory gives more CPU (one core per 4 GB) for the same price per image. Target-size mode encodes each image up to about 8 times, so it is slower.
- **PNG**: lossless PNG output of a photo is often larger than the input. With `targetKb`, PNG is reduced to a 256-colour palette when lossless doesn't fit, which suits graphics better than photos.
- **Animations**: animated GIFs and WebPs are converted to a still image of the first frame.
- **Metadata**: with `stripMetadata` on, colours are converted to sRGB so they look the same everywhere. Turn it off to keep EXIF and the colour profile (HEIC metadata is not carried over).

## FAQ

**Which HEIC files are supported?** HEIC and HEIF photos from iPhones and other cameras, decoded with libheif and libde265. The primary image is converted; depth maps and other auxiliary images are ignored.

**Which formats can't it read?** RAW camera files, PDF, PSD, ICO, JPEG XL and RLE-compressed BMP. Convert those to TIFF or PNG first.

**Are my images sent anywhere else?** No. Everything runs inside the actor's container on Apify. The converted files stay in your run's key-value store.

**Can AI agents use it?** Yes, through the Apify API, the Apify MCP server or any Apify integration (Make, Zapier, n8n, LangChain).

**Disclaimer:** You are responsible for having the right to process the images you submit.

## Open-source software

This actor runs [sharp](https://sharp.pixelplumbing.com/) (Apache-2.0) with its bundled [libvips](https://www.libvips.org/) (LGPL-3.0), and Debian's [libheif](https://github.com/strukturag/libheif) (LGPL-3.0) with [libde265](https://github.com/strukturag/libde265) (LGPL-3.0) for HEIC. See `THIRD_PARTY_NOTICES.md` in the source for all notices. It is not affiliated with or endorsed by these projects.

## Related actors

- [AI Image Upscaler](https://apify.com/cprussin/image-upscaler?fpr=to54nm): Upscale and enhance images 2x, 3x or 4x with Real-ESRGAN.
- [Video Frame Extractor](https://apify.com/cprussin/video-frame-extractor?fpr=to54nm): Thumbnails, scene keyframes, contact sheets and GIFs from video files.
- [Website Screenshot API](https://apify.com/cprussin/website-screenshot?fpr=to54nm): Full-page or viewport screenshots and PDFs of any URL.
