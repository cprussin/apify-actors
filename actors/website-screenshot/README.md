# Website Screenshot API: Full-Page PNG, JPEG, WebP & PDF

**Website Screenshot API** captures any web page as a PNG, JPEG, WebP or PDF file. Paste URLs, get back a public link to each screenshot plus its status, title, size and load time, as JSON, CSV or Excel:

- ✅ **Full-page or viewport** screenshots, or **one element** by CSS selector.
- ✅ **PNG, JPEG, WebP or PDF**, with adjustable JPEG/WebP quality.
- ✅ **Device presets**: desktop (1920x1080), tablet (iPad) and mobile (iPhone, with mobile user agent and touch), or any custom width and height.
- ✅ **Cookie banners hidden**: OneTrust, Cookiebot, Usercentrics, Didomi, Quantcast and dozens more.
- ✅ **Lazy content**: optional scroll-through so lazy images and sections render before a full-page capture.
- ✅ **Reliable**: a page that times out is retried once with a lighter load condition, and one bad URL never fails the run.
- ✅ **Fast**: one shared browser, a fresh context per page, pages captured in parallel.
- ✅ **Pay only for screenshots that work.** Failed URLs are recorded with the reason, for free.

## Who uses a website screenshot API?

- **Developers**: thumbnails, link previews and OG images for apps and dashboards.
- **QA and design teams**: visual checks of pages on desktop, tablet and mobile.
- **SEO and marketing**: archive competitor landing pages, pricing pages and ads.
- **Compliance and legal**: timestamped PDF or image proof of what a page showed.
- **AI agents**: give a vision model a picture of any page through the Apify API or MCP server.

## How does the website screenshot actor work?

1. Add one or more URLs and pick a format, device and options.
2. The actor opens each URL in headless Chromium, waits for the page to load (and for your selector, if set), hides cookie banners and optionally scrolls through the page.
3. It saves the screenshot or PDF to the run's key-value store and writes one dataset item per URL with a public link to the file.
4. If a page doesn't finish loading in time, it's retried once with a lighter load condition (Network idle → Load → DOM ready). If it still fails, you get an item with the error and aren't charged.

Only the URLs you give are loaded. The actor doesn't crawl or follow links.

## How do I set up website screenshots?

| Field                | Description                                               | Example                            |
| -------------------- | --------------------------------------------------------- | ---------------------------------- |
| `urls`               | Pages to capture (`https://` is added if missing)         | `["https://apify.com"]`            |
| `startUrls`          | Same, in Apify request-list format (combined with `urls`) | `[{ "url": "https://apify.com" }]` |
| `format`             | `png`, `jpeg`, `webp` or `pdf`                            | `"pdf"`                            |
| `fullPage`           | Whole scrollable page instead of the viewport             | `true`                             |
| `device`             | `desktop`, `tablet` or `mobile`                           | `"mobile"`                         |
| `width` / `height`   | Custom viewport size in px (overrides the device preset)  | `1440` / `900`                     |
| `quality`            | JPEG/WebP quality, 1-100 (default 80)                     | `70`                               |
| `waitUntil`          | `load` (default), `domcontentloaded` or `networkidle`     | `"networkidle"`                    |
| `delayMs`            | Extra wait after load, in ms                              | `1000`                             |
| `waitForSelector`    | CSS selector to wait for before capturing                 | `"#main"`                          |
| `selector`           | Capture only this element                                 | `".pricing-table"`                 |
| `hideCookieBanners`  | Hide common cookie-consent banners (default on)           | `true`                             |
| `scrollToBottom`     | Scroll through the page first so lazy content loads       | `true`                             |
| `timeoutSecs`        | Max load time per URL (default 30)                        | `60`                               |
| `maxConcurrency`     | Pages captured in parallel (default 3)                    | `5`                                |
| `proxyConfiguration` | Optional Apify Proxy, e.g. for geo-specific pages         | `{ "useApifyProxy": true }`        |

Example: full-page mobile PDFs of two pages, after lazy content loads.

```json
{
  "urls": ["https://apify.com", "https://apify.com/pricing"],
  "format": "pdf",
  "fullPage": true,
  "device": "mobile",
  "scrollToBottom": true
}
```

## What data do you get for each screenshot?

```json
{
  "url": "https://apify.com/",
  "finalUrl": "https://apify.com/",
  "status": 200,
  "screenshotKey": "screenshot-0001-apify-com.png",
  "screenshotUrl": "https://api.apify.com/v2/key-value-stores/aBcD1234eFgH5678/records/screenshot-0001-apify-com.png",
  "format": "png",
  "device": "desktop",
  "width": 1920,
  "height": 1080,
  "bytes": 202501,
  "title": "Apify: Marketplace of ready-to-run tools for AI",
  "loadTimeMs": 2310,
  "waitUntil": "load",
  "error": null,
  "capturedAt": "2026-10-02T00:00:00.000Z"
}
```

- `screenshotUrl` is a direct link to the file; `screenshotKey` is its key in the run's default key-value store.
- `width`/`height` are the image size in pixels (tablet and mobile render at 2x, so a 390 px mobile viewport gives a 780 px wide image). For PDFs they are the page size in CSS px.
- `waitUntil` is the load condition that worked; it's lighter than requested when the first attempt timed out.
- A failed URL has `error` set (e.g. `net::ERR_NAME_NOT_RESOLVED` or a timeout), no file, and isn't billed.
- Pages that return 404 or 500 are still captured (that's what the page shows); check `status`.

## How much does a website screenshot cost?

Pay-per-event, only for successful screenshots:

| Event      | Price      |
| ---------- | ---------- |
| Screenshot | **$0.003** |

That's **$3 per 1,000 screenshots or PDFs**, any format or size. Failed URLs are free. The default input (one screenshot of apify.com) costs $0.003. If you set a **maximum cost per run**, the actor stops cleanly when it reaches it.

## Tips for website screenshots

- **Full-page screenshots of modern sites:** turn on `scrollToBottom` so lazy-loaded images appear, and add `delayMs` (500-2000) for animations.
- **Slow or chatty pages:** `load` is the best default. `networkidle` waits for all network activity to stop, which some sites never do; the actor then falls back to `load` automatically.
- **Smaller files:** use `jpeg` or `webp` with `quality` 60-80. WebP pages taller than 16,383 px are saved as PNG (a WebP format limit).
- **Thumbnails:** capture the viewport only (`fullPage: false`) with a small custom `width`/`height`.
- **Many URLs:** raise `maxConcurrency` together with the run's memory (about 1 GB per 2-3 parallel pages).
- **Scheduled monitoring:** schedule the actor and compare `bytes` or the images between runs, or send the links to Slack or Google Drive with Apify integrations.

## Website screenshot FAQ

**How is this different from the free screenshot actor?** It's built for reliability and volume: a timed-out page is retried with a lighter load condition, one failed URL never fails the run, every result says why it failed, and you're only charged for screenshots that worked. It also does full-page PDFs, WebP, device presets, element capture and cookie-banner hiding.

**Can I screenshot a page behind a login?** No. The actor opens each URL as a logged-out visitor.

**Why is a cookie banner still visible?** Banners are hidden with CSS by matching known consent tools. Unusual or custom banners may stay visible. Nothing is clicked, so no consent is given on your behalf.

**Why did a page time out?** Some sites load slowly or block datacenter traffic. Increase `timeoutSecs`, use `waitUntil: "domcontentloaded"`, or enable Apify Proxy.

**How long are the files kept?** In the run's default key-value store, for your account's data retention period. Download them or copy them elsewhere if you need them longer.

**Can I use it through the API or with AI agents?** Yes. Call it through the Apify API, the Apify MCP server or any Apify integration, then fetch the image from `screenshotUrl`.

**Disclaimer:** You are responsible for having the right to capture and use screenshots of the pages you request, and for complying with each site's terms and applicable laws.

## Related actors

- [google-ads-transparency](https://apify.com/cprussin/google-ads-transparency): Ads from the Google Ads Transparency Center by advertiser or domain.
- [product-hunt-launches](https://apify.com/cprussin/product-hunt-launches): Product Hunt launches, leaderboards, upvotes and makers.
- [trustpilot-reviews](https://apify.com/cprussin/trustpilot-reviews): Trustpilot reviews, ratings and TrustScore for any company.
