# AliExpress Scraper: Products, Prices & Reviews

**AliExpress Scraper** pulls **AliExpress product search results** and **buyer reviews** into a clean dataset: title, sale price and original price, discount, currency, **orders sold**, star rating, store, images, delivery estimate and search rank, plus review stars, text, date, buyer country, SKU/variant, photos, helpful votes and follow-up reviews. Search by **keyword** or paste any **AliExpress search URL**. Or give **product IDs / item URLs** to get reviews only.

- ✅ **Products and reviews in one run.** Search "wireless earbuds", get about 60 products per page and the reviews of the top products.
- ✅ **Real sales numbers.** `soldCount` is the exact order count when AliExpress exposes it (e.g. `58903`), not just "50,000+".
- ✅ **Any ship-to country and currency** (US/USD, GB/GBP, DE/EUR, BR/BRL, ...), so prices and delivery estimates match your market.
- ✅ **Review translations** into your language, alongside the original text.
- ✅ **Sort** by best match, orders (best sellers) or price, up to 60 pages per search.
- ✅ **Polite and robust:** one request at a time with random pauses, bot-check detection, automatic session rotation and back-off, and fallback to Apify datacenter proxy. No residential proxy needed.
- ✅ **Pay per result.** No monthly rent. Failed requests, duplicates and blocked pages are never charged.

## Who uses AliExpress product and review data?

- **Dropshippers and e-commerce sellers:** find winning products by orders sold and rating, track supplier prices and discounts.
- **Product research and sourcing teams:** compare prices across suppliers and ship-to countries.
- **Brand protection:** monitor listings that use your brand name.
- **Market and pricing analysts:** build price indexes, track bestseller rankings and discount depth over time with scheduled runs.
- **Review mining and AI teams:** collect buyer reviews with star ratings, photos and variants for sentiment analysis, quality control or LLM summaries.
- **Agencies:** deliver weekly product or competitor reports via Apify integrations (Google Sheets, Slack, email, webhooks, Make, Zapier).

## How does the AliExpress scraper work?

1. Enter **keywords** (one search per keyword) and/or **search URLs** from AliExpress with your filters applied.
2. The actor reads each result page's embedded data (about 60 products per page) up to **Max pages per search**.
3. If **Scrape reviews** is on, it fetches reviews for the **top N products** of each search (20 per request) up to **Max reviews per product**. Products in **Product IDs** get reviews without a search.
4. Everything goes into one dataset. Each item has `type: "product"` or `type: "review"`; the **Products** and **Reviews** views show each kind.

The actor only reads public search result pages and the public review feed. It never opens product detail pages, logs in or solves captchas.

## How do I choose which AliExpress products to scrape?

| Field                   | Description                                                                             | Example                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `keywords`              | Search terms, one search each                                                           | `["wireless earbuds", "phone case"]`                                           |
| `searchUrls`            | AliExpress search / category URLs (filters kept)                                        | `["https://www.aliexpress.com/w/wholesale-led-strip.html?SortType=price_asc"]` |
| `maxPagesPerKeyword`    | Result pages per search (≈60 products each, max 60)                                     | `3`                                                                            |
| `sort`                  | `default`, `orders`, `priceAsc`, `priceDesc`                                            | `"orders"`                                                                     |
| `includeReviews`        | Also fetch reviews for search results                                                   | `true`                                                                         |
| `reviewsForTopProducts` | Reviews for the first N products of each search (0 = all)                               | `5`                                                                            |
| `productIds`            | Item IDs or URLs to fetch reviews for, without searching                                | `["1005007502032342"]`                                                         |
| `maxReviewsPerProduct`  | Review cap per product                                                                  | `100`                                                                          |
| `translateReviews`      | Add machine translations (`translatedText`) in `language`                               | `true`                                                                         |
| `shipTo`                | Ship-to country (affects prices, availability, delivery)                                | `"US"`, `"GB"`, `"DE"`                                                         |
| `currency`              | Price currency                                                                          | `"USD"`, `"EUR"`                                                               |
| `language`              | Site / translation language                                                             | `"en"`                                                                         |
| `onlyNew`               | Monitoring: only products/reviews not returned by an earlier run with the same input    | `true`                                                                         |
| `proxyConfiguration`    | Optional. Default: direct, with automatic fallback to Apify datacenter proxy if blocked | `{ "useApifyProxy": true }`                                                    |

Example: top 3 pages of best sellers for two keywords, with 50 reviews for each of the top 5 products:

```json
{
  "keywords": ["wireless earbuds", "smart watch"],
  "maxPagesPerKeyword": 3,
  "sort": "orders",
  "includeReviews": true,
  "reviewsForTopProducts": 5,
  "maxReviewsPerProduct": 50,
  "shipTo": "US",
  "currency": "USD"
}
```

Reviews only:

```json
{
  "keywords": [],
  "productIds": ["https://www.aliexpress.com/item/1005007502032342.html"],
  "maxReviewsPerProduct": 500
}
```

## What data do you get from AliExpress?

Product:

```json
{
  "type": "product",
  "productId": "1005011807602955",
  "title": "2026 New Air 3 Pro 3 Bluetooth Wireless Earbuds with Heart Rate Monitoring, Active Noise Cancellation…",
  "url": "https://www.aliexpress.com/item/1005011807602955.html",
  "imageUrl": "https://ae-pic-a1.aliexpress-media.com/kf/Sa57a4580c1274b01988d5df3fa8e76cbx.jpg",
  "images": [
    "https://ae-pic-a1.aliexpress-media.com/kf/Sa57a4580c1274b01988d5df3fa8e76cbx.jpg",
    "…"
  ],
  "price": 21.11,
  "originalPrice": 57.2,
  "discountPercent": 63,
  "currency": "USD",
  "formattedPrice": "US $21.11",
  "soldCount": 4084,
  "soldText": "4,000+ sold",
  "rating": 4.9,
  "storeName": "Shop1105233629 Store",
  "isAd": false,
  "isChoice": false,
  "shipping": null,
  "delivery": null,
  "sellingPoints": ["New shoppers save $36.09"],
  "categoryIds": ["44", "100000306", "63705"],
  "listedAt": "2026-03-09",
  "searchKeyword": "wireless earbuds",
  "searchUrl": "https://www.aliexpress.com/w/wholesale-wireless-earbuds.html?page=1",
  "searchPage": 1,
  "position": 1,
  "shipTo": "US",
  "scrapedAt": "2026-09-30T05:14:58.671Z"
}
```

Review:

```json
{
  "type": "review",
  "productId": "1005011807602955",
  "productTitle": "2026 New Air 3 Pro 3 Bluetooth Wireless Earbuds…",
  "reviewId": "60096451623486425",
  "rating": 5,
  "text": "Exactly as described. Decent sound. Stable connection. 3-4hr battery life…",
  "translatedText": null,
  "date": "2026-04-07",
  "dateText": "07 Apr 2026",
  "buyerName": "j***i",
  "buyerCountry": "US",
  "skuInfo": "Color:Blackpods A7",
  "images": [],
  "helpfulCount": 6,
  "unhelpfulCount": 0,
  "additionalFeedback": null,
  "additionalFeedbackDate": null,
  "additionalImages": [],
  "logistics": "AliExpress Standard Shipping",
  "productUrl": "https://www.aliexpress.com/item/1005011807602955.html",
  "scrapedAt": "2026-09-30T05:15:01.240Z"
}
```

**Field notes**

- `price` is the price shown in search results (the sale price, often a new-shopper or bundle deal). `originalPrice` is the list price before discount, when shown.
- `soldCount` is the exact order count when available, otherwise parsed from `soldText` ("10,000+ sold" → 10000).
- `storeName` only appears when AliExpress includes it in search results (often for sponsored items). Otherwise it's `null`.
- `shipping` / `delivery` come from the badges on the result card ("Free shipping", "Delivery: Oct 05 - 12"), when shown.
- **EU and UK ship-to countries** get lean result cards from AliExpress: title, price and image, but no rating or sold count. Use a non-EU `shipTo` (e.g. `US`) if you need those.
- `rating` on reviews is 1–5 stars. `buyerName` is the masked name AliExpress displays (e.g. `j***i`).
- `date` is ISO `YYYY-MM-DD`. With translation into a non-English language AliExpress localizes the date text; then `date` may be `null` and `dateText` keeps the original.
- A run summary (pages, counts, status per search and product) is saved to the `SUMMARY` record in the key-value store.

## How much does it cost to scrape AliExpress?

Pay-per-event, only for results you get:

| Event                       | Price      |
| --------------------------- | ---------- |
| Product (one search result) | **$0.004** |
| Review                      | **$0.002** |

That's **$4 per 1,000 products** and **$2 per 1,000 reviews**. A one-page search (60 products) costs about $0.24. Duplicates, errors and blocked pages are not charged. Set a **maximum cost per run** and the actor stops cleanly when it's reached.

## Tips for scraping AliExpress products and reviews

- **Best sellers:** `sort: "orders"` plus a few pages gives the top products in a niche by order volume.
- **Price monitoring:** schedule a run daily or weekly and compare `price` and `soldCount` per `productId`.
- **Keep costs predictable:** use `maxPagesPerKeyword`, `reviewsForTopProducts` and `maxReviewsPerProduct`, and set a max cost per run.
- **Pasted URLs:** filters you set on AliExpress (price range, free shipping, ratings) are kept in the URL, so paste the URL into `searchUrls`.
- **Blocking:** AliExpress sometimes shows a slider captcha to automated traffic. The actor detects it, pauses, rotates the session and, if you didn't set a proxy, switches to Apify datacenter proxy. It never reports a run as successful with zero results.

## How do I monitor AliExpress for new items?

Turn on `onlyNew` and run the actor on an [Apify schedule](https://docs.apify.com/platform/schedules) (e.g. daily; save the input as a task and schedule the task).

- The first run is a baseline and returns everything as usual. Later runs return, and charge for, only products (by `productId`) and reviews (by product and `reviewId`) not returned before. Skipped items are never charged.
- Review paging for a product stops after two pages with nothing new, so quiet days cost almost nothing.
- State lives in your account in the key-value store `aliexpress-scraper-state`, one record per combination of searches, product IDs, sort, reviews setting and ship-to country. Changing any of these starts a new baseline. It remembers the latest 50,000 items.
- Add a Slack, email or webhook integration to the task to get alerts.

## AliExpress scraper FAQ

**Does it need an AliExpress account, API key or cookies?** No. It reads public search results and public reviews.

**Does it scrape product detail pages (full description, all SKUs, stock)?** No. Detail pages are heavily bot-protected; this actor sticks to search results and the review feed, which are fast and reliable. Use the `url` field to open a product.

**How many products can I get per search?** About 60 per page and up to 60 pages (AliExpress's limit), so up to ~3,600 per keyword. Use several keywords or filtered search URLs for more.

**Why are some reviews in other languages?** AliExpress shows reviews from buyers worldwide. Turn on `translateReviews` to add translations.

**Can I use it through the API or with AI agents?** Yes: Apify API, the Apify MCP server, or any Apify integration. Pricing is per event only.

**Is scraping AliExpress legal?** The actor only collects publicly available data that anyone can see without logging in. Reviews contain masked buyer names and free text; you are responsible for how you store and use the data (e.g. GDPR) and for complying with AliExpress's terms.

**Disclaimer:** This actor is not affiliated with, endorsed by or sponsored by AliExpress or Alibaba Group. AliExpress is a trademark of Alibaba Group.

## Related actors

- [google-flights-prices](https://apify.com/cprussin/google-flights-prices?fpr=to54nm): Google Flights itineraries and prices across date ranges.
- [trustpilot-reviews](https://apify.com/cprussin/trustpilot-reviews?fpr=to54nm): Trustpilot reviews, ratings and TrustScore for any company.
- [google-trends](https://apify.com/cprussin/google-trends?fpr=to54nm): Google Trends interest over time, regions, related queries and trending searches.
