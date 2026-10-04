# Eventbrite Events Scraper: Venues, Organizers & Prices

**Eventbrite Events Scraper** exports events from Eventbrite as clean JSON, CSV or Excel. It reads the same public event search and event pages that eventbrite.com shows, with no login and no API key:

- ✅ **Events by city**: any Eventbrite location (`ny--new-york`, `ca--san-francisco`, `united-kingdom--london`, ...) or `online`.
- ✅ **Filters**: category (Music, Business, Food & Drink, Nightlife, ...), date (today, this weekend, next month, ...) and keyword.
- ✅ **Dates done right**: local start/end time, IANA time zone and UTC timestamps.
- ✅ **Venue**: name, full address, city, region, postal code, country, latitude and longitude, plus an online flag.
- ✅ **Organizer and tickets**: organizer name and Eventbrite page, price range, currency, free flag and sales status.
- ✅ **Content**: category, subcategory, format, organizer tags, image, summary and the full description as plain text.
- ✅ **Start URLs**: paste any Eventbrite search page or event page.
- ✅ Deduplicated across searches, so an event that matches two searches is returned (and billed) once.
- ✅ Handles rate limits: new proxy IP on every blocked or failed request, direct fallback when the proxy is down.
- ✅ Fast and light: plain HTTP requests, no browser. Pay only for events written to your dataset.

## Who uses Eventbrite event data?

- **Event marketers and promoters**: track competing events, prices and venues in your city.
- **Sales and lead generation**: find active event organizers, venues and sponsors by city and category.
- **Travel and local guides**: build "things to do" feeds for a city and date range.
- **Analysts**: study ticket pricing, event formats and seasonality across cities.
- **AI agents**: give an LLM live local event listings through the Apify API or MCP server.

## How does the Eventbrite scraper work?

1. Add locations (or Eventbrite URLs), plus an optional category, date and keyword.
2. The actor loads the search page, e.g. `eventbrite.com/d/ny--new-york/music--events--this-weekend/`, and reads the event data embedded in it (the same data the page renders).
3. With **Include event details** on, it also opens each event page for the organizer, prices, sales status and full description.
4. It follows `?page=2`, `?page=3`, ... (20 events per page) until `maxEvents` events in total.

## How do I choose which Eventbrite events to scrape?

| Field                | Description                                                                   | Example                                                    |
| -------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `locations`          | Eventbrite location slugs, or `online`                                        | `["ny--new-york", "united-kingdom--london"]`               |
| `startUrls`          | Eventbrite search or event pages (optional)                                   | `["https://www.eventbrite.com/d/ca--san-francisco/jazz/"]` |
| `category`           | Category slug, applied to every location                                      | `"music"`                                                  |
| `dateFilter`         | `today`, `tomorrow`, `this-weekend`, `this-week`, `next-week`, ...            | `"this-weekend"`                                           |
| `keyword`            | Search keyword                                                                | `"wine tasting"`                                           |
| `maxEvents`          | Max events in total, across all searches                                      | `500`                                                      |
| `includeDetails`     | Open each event page for organizer, prices and description                    | `false`                                                    |
| `onlyNew`            | Monitoring: only events not returned by an earlier run with the same searches | `true`                                                     |
| `proxyConfiguration` | Apify Proxy (on by default; datacenter is enough)                             | `{ "useApifyProxy": true }`                                |

- **Location slugs** are what you see in Eventbrite URLs: `eventbrite.com/d/`**`ny--new-york`**`/events/`. US cities use `<state>--<city>`, other countries `<country>--<city>`.
- Start URLs keep their own filters; `category`, `dateFilter` and `keyword` apply only to `locations`. `?page=N` sets the first page.

Example: music events in New York and San Francisco this weekend, up to 200.

```json
{
  "locations": ["ny--new-york", "ca--san-francisco"],
  "category": "music",
  "dateFilter": "this-weekend",
  "maxEvents": 200
}
```

## What data do you get for each Eventbrite event?

```json
{
  "eventId": "1990839672051",
  "name": "Friday Night Lights at Mama Taco Everyone FREE B4 12am w/RSVP",
  "url": "https://www.eventbrite.com/e/friday-night-lights-at-mama-taco-everyone-free-b4-12am-wrsvp-tickets-1990839672051",
  "startDate": "2026-10-02T20:00:00",
  "endDate": "2026-10-03T04:00:00",
  "timezone": "America/New_York",
  "startUtc": "2026-10-03T00:00:00.000Z",
  "endUtc": "2026-10-03T08:00:00.000Z",
  "isOnline": false,
  "venueName": "MAMATACO",
  "venueAddress": "880 Flushing Avenue, Brooklyn, NY 11206",
  "venueCity": "Brooklyn",
  "venueRegion": "NY",
  "venuePostalCode": "11206",
  "venueCountry": "US",
  "latitude": 40.7018895,
  "longitude": -73.936578,
  "organizerId": "5494940201",
  "organizerName": "JiggyTime Ent",
  "organizerUrl": "https://www.eventbrite.com/o/jiggytime-ent-5494940201",
  "isFree": false,
  "priceMin": 0,
  "priceMax": 55.2,
  "currency": "USD",
  "salesStatus": "on_sale",
  "category": "Music",
  "subcategory": "Hip Hop / Rap",
  "format": "Party or Social Gathering",
  "tags": ["Reggae", "Afrobeats", "Reggaeton", "Dancehall", "Nycnightlife"],
  "imageUrl": "https://img.evbuc.com/https%3A%2F%2Fcdn.evbuc.com%2Fimages%2F1194695043%2F48251508672%2F1%2Foriginal.20260930-042650?auto=format%2Ccompress&q=75&sharp=10&s=f70b4f5ae73f4aa7fe2af627fbec8fc7",
  "summary": "Kick off your weekend with free entry before midnight when you RSVP for the ultimate Friday night bash!",
  "description": "FRIDAY, OCTOBER 2ND | 8PM - 4AM\nLIBRA SZN TAKEOVER BROOKLYN'S #1 FRIDAY NIGHT PARTY\n...",
  "isCancelled": false,
  "seriesId": null,
  "publishedAt": "2026-06-02T05:10:10Z",
  "searchUrl": "https://www.eventbrite.com/d/ny--new-york/all-events/",
  "scrapedAt": "2026-10-01T00:00:00.000Z"
}
```

- `startDate`/`endDate` are local times at the venue; `startUtc`/`endUtc` are the same moments in UTC.
- `priceMin`/`priceMax` are the ticket price range in `currency` as Eventbrite lists it. `priceMin` is `0` when a free ticket type exists.
- `organizerName`, `organizerUrl`, prices, `currency`, `isFree`, `salesStatus` and `description` need **Include event details**. Without it they are `null` (and `description` is left out).
- `salesStatus` is Eventbrite's ticket sales status, e.g. `on_sale` or `sold_out`.
- Online events have `isOnline: true` and no venue fields.

## How much does it cost to scrape Eventbrite events?

Pay-per-event, only for events written to your dataset:

| Event | Price      |
| ----- | ---------- |
| Event | **$0.005** |

That's **$5 per 1,000 events**, with or without details. The default input (20 events in New York, with details) costs $0.10. If you set a **maximum cost per run**, the actor stops cleanly when it reaches it.

## Tips for scraping Eventbrite events

- **Weekly event feed:** schedule the actor with `dateFilter: "this-week"` and `onlyNew: true` so each event arrives once. Send events to Google Sheets, Slack or a webhook with Apify integrations.
- **Organizer leads:** run a category across several cities with details on, then group by `organizerUrl` to get the most active organizers.
- **Faster bulk runs:** turn off `includeDetails` when you only need names, dates, venues and categories. It's one request per 20 events instead of one per event.
- **Find the right slug:** search a city on eventbrite.com and copy it from the URL, or paste the URL into `startUrls`.

## How do I monitor Eventbrite for new items?

Turn on `onlyNew` and run the actor on an [Apify schedule](https://docs.apify.com/platform/schedules) (e.g. daily; save the input as a task and schedule the task).

- The first run is a baseline and returns events as usual. Later runs return, and charge for, only events (by `eventId`) not returned before. Skipped events are never charged, and their event pages are not opened.
- `maxEvents` counts only new events.
- State lives in your account in the key-value store `eventbrite-events-state`, one record per set of searches (locations, category, date filter, keyword, start URLs). Changing any of these starts a new baseline. It remembers the latest 50,000 events.
- Add a Slack, email or webhook integration to the task to get alerts.

## Eventbrite scraper FAQ

**Is this an official Eventbrite API?** No. It reads the public search and event pages that eventbrite.com shows to logged-out visitors. It does not use Eventbrite's internal search API.

**How many events can I get per search?** Eventbrite shows up to about 50 pages (roughly 1,000 events) per search. Narrow it with a category, date or keyword, or split it across several searches.

**Why do I see an event from another city?** Eventbrite's search sometimes mixes in events it considers relevant from elsewhere. Filter on `venueCity`, `venueCountry` or the coordinates if you need exact matches.

**Why is a field `null`?** Organizers don't always fill in everything, e.g. online events have no venue and some events hide prices. Prices and organizer names need **Include event details**.

**Do I need a proxy?** Apify Proxy (datacenter) is enabled by default, and the actor switches IP automatically when a request is blocked.

**Can I use it through the API or with AI agents?** Yes. Call it through the Apify API, the Apify MCP server or any Apify integration.

**Disclaimer:** This actor is not affiliated with, endorsed by or sponsored by Eventbrite. Eventbrite is a trademark of its owner. You are responsible for complying with Eventbrite's terms and applicable laws when using the data.

## Related actors

- [google-flights-prices](https://apify.com/cprussin/google-flights-prices?fpr=to54nm): Google Flights itineraries and prices across date ranges.
- [new-business-registrations](https://apify.com/cprussin/new-business-registrations?fpr=to54nm): New LLC and corporation filings from state open-data portals.
- [trustpilot-reviews](https://apify.com/cprussin/trustpilot-reviews?fpr=to54nm): Trustpilot reviews, ratings and TrustScore for any company.
