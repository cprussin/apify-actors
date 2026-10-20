# Luma Events Scraper: lu.ma Cities, Calendars & Tickets

**Luma Events Scraper** exports events from [Luma](https://luma.com) (lu.ma) as clean JSON, CSV or Excel. It reads the same public event data that luma.com shows to logged-out visitors, with no login and no API key:

- ✅ **Events by city**: any Luma city (`nyc`, `sf`, `london`, `berlin`, `singapore`, ... 87 cities) or any point as `latitude,longitude`.
- ✅ **Filters**: Luma category (Tech, AI, Food & Drink, Arts, Climate, Fitness, ...) and keyword.
- ✅ **Calendars and events**: paste a community calendar (e.g. `luma.com/genai-sf`) for all its upcoming or past events, or single event links.
- ✅ **Dates done right**: UTC timestamps, IANA time zone and local start/end time.
- ✅ **Venue**: name, full address, city, region, country, latitude and longitude, plus online flag. Guests-only addresses stay hidden, as on luma.com.
- ✅ **Tickets**: free flag, price range and currency, sold-out, spots left, approval required and waitlist; ticket types with details.
- ✅ **Who runs it**: host names, guest count, and the calendar (community) behind the event.
- ✅ **Content**: cover image, categories and the full description as plain text.
- ✅ Deduplicated across cities and calendars, so each event is returned (and billed) once.
- ✅ Fast and light: Luma's public JSON, no browser, 50 events per request. Pay only for events written to your dataset.

It never outputs guest lists or attendee profiles.

## Start in one minute

Click **Start** with the prefilled input:

```json
{
  "cities": ["nyc"],
  "maxEvents": 20
}
```

You get: 20 upcoming events in New York with `name`, `startLocal`, `venueName`, `venueAddress`, `hostNames`, `priceMin`/`priceMax`, `guestCount`, `description` and `url`.

**Cost:** $0.07: 20 events × $0.0025 + 20 event details × $0.001, plus the $0.00005 actor-start fee.

## Use with an AI assistant

Connect the [Apify MCP server](https://mcp.apify.com) to Claude, ChatGPT, Cursor or any MCP client (`https://mcp.apify.com?tools=cprussin/luma-events` loads only this actor), then paste:

```text
Use the Apify actor cprussin/luma-events to find 20 AI events in San Francisco on Luma, and list name, date, venue, hosts and guest count.
```

## Recipes

### AI and tech events in several cities

```json
{
  "cities": ["sf", "nyc", "london"],
  "category": "ai",
  "maxEvents": 300,
  "includeDetails": false
}
```

### Hackathons by keyword

```json
{
  "cities": ["sf", "berlin", "bengaluru"],
  "keyword": "hackathon",
  "maxEvents": 100
}
```

### Everything a community calendar runs

All upcoming events of one or more Luma calendars.

```json
{
  "startUrls": ["https://luma.com/genai-sf"],
  "maxEvents": 200
}
```

### Events around any point

Luma has no Boulder city page, so search around its coordinates.

```json
{
  "cities": ["40.015,-105.27"],
  "maxEvents": 50
}
```

### New-event alerts

Schedule it daily: after the first run you get (and pay for) only events not returned before.

```json
{
  "cities": ["nyc"],
  "category": "tech",
  "maxEvents": 100,
  "includeDetails": false,
  "onlyNew": true
}
```

## Who uses Luma event data?

- **Startup and developer ecosystems**: track AI, tech and founder events, hackathons and demo days by city.
- **Sales and partnerships**: find active communities, hosts and venues, and the events your prospects attend.
- **Event marketers and community managers**: watch competing events, pricing, capacity and turnout (`guestCount`).
- **Local guides and newsletters**: build "what's on this week" feeds for a city or category.
- **AI agents**: give an LLM live local event listings through the Apify API or MCP server.

## How does the Luma scraper work?

1. Add cities (or Luma URLs), plus an optional category and keyword.
2. The actor resolves each city to its coordinates and pages through Luma's public discover feed for that area (50 events per request), the same data luma.com shows.
3. Calendar URLs page through that calendar's event list; event URLs return that event.
4. With **Include event details** on, it also loads each event's details for the description, categories and ticket types.

## How do I choose which Luma events to scrape?

| Field                | Description                                                                | Example                           |
| -------------------- | -------------------------------------------------------------------------- | --------------------------------- |
| `cities`             | Luma city slugs or `latitude,longitude` points                             | `["nyc", "sf", "40.015,-105.27"]` |
| `startUrls`          | Luma calendar, event or city pages (optional)                              | `["https://luma.com/genai-sf"]`   |
| `category`           | Luma category, applied to every city                                       | `"ai"`                            |
| `keyword`            | Search keyword, applied to every city (up to 50 matches per city)          | `"hackathon"`                     |
| `calendarPeriod`     | `future` (default) or `past` events for calendar URLs                      | `"past"`                          |
| `maxEvents`          | Max events in total, across all cities and URLs                            | `500`                             |
| `includeDetails`     | Load each event's description, categories and ticket types                 | `false`                           |
| `onlyNew`            | Monitoring: only events not returned by an earlier run with the same input | `true`                            |
| `proxyConfiguration` | Optional Apify Proxy (off by default; not needed)                          | `{ "useApifyProxy": true }`       |

- **City slugs** are what you see in Luma URLs: `luma.com/`**`nyc`**. Luma has city pages for 87 cities; anywhere else, use `latitude,longitude`.
- Category and keyword apply to cities, not to calendar or event URLs.

## What data do you get for each Luma event?

```json
{
  "eventId": "evt-yEE1YSoVZ8qHMGt",
  "name": "Mem-Off! The Open Source AI Memory Showdown",
  "url": "https://luma.com/cognee-cy86",
  "startUtc": "2026-10-17T17:30:00.000Z",
  "endUtc": "2026-10-18T01:30:00.000Z",
  "timezone": "America/Los_Angeles",
  "startLocal": "2026-10-17T10:30:00",
  "endLocal": "2026-10-17T18:30:00",
  "locationType": "offline",
  "isOnline": false,
  "venueName": "Pebblebed",
  "venueAddress": "Pebblebed, 1417 15th St, San Francisco, CA 94103, USA",
  "venueCity": "San Francisco",
  "venueRegion": "California",
  "venueCountry": "United States",
  "venueCountryCode": "US",
  "latitude": 37.7666648,
  "longitude": -122.4161551,
  "addressHidden": false,
  "isFree": true,
  "priceMin": 0,
  "priceMax": 0,
  "currency": null,
  "isSoldOut": false,
  "spotsRemaining": null,
  "requiresApproval": false,
  "waitlistActive": false,
  "guestCount": 202,
  "hostNames": ["cognee", "George Curtis", "Claude-Mem 🧠", "AJ Green"],
  "calendarId": "cal-hpIcdwBuL8vfdba",
  "calendarName": "cognee",
  "calendarUrl": "https://luma.com/cognee",
  "imageUrl": "https://images.lumacdn.com/uploads/7p/9231c06e-87c0-4442-8f15-b1523daaceb7.jpg",
  "recurrenceId": null,
  "source": "calendar:genai-sf",
  "scrapedAt": "2026-10-17T00:00:00.000Z",
  "categories": ["AI"],
  "ticketTypes": [
    { "name": "Standard", "price": 0, "currency": null, "type": "free" }
  ],
  "description": "Mem Off - The AI Memory Showdown\n\nEveryone claims their AI has memory. But does it actually work?\n\n..."
}
```

- `startLocal`/`endLocal` are local times at the event; `startUtc`/`endUtc` are the same moments in UTC.
- `addressHidden: true` means the host shows the exact address to registered guests only: `venueName` and `venueAddress` are `null`, and the coordinates are Luma's approximate ones.
- `priceMin`/`priceMax` are in currency units (not cents). Free events have `isFree: true` and prices of `0`.
- `calendarName` and `calendarUrl` are `null` when the event is on a host's personal calendar.
- `categories`, `ticketTypes` and `description` need **Include event details**; without it they are left out.
- `source` says what found the event: `city:nyc`, `coords:40.015,-105.27`, `calendar:genai-sf` or `event:<slug>`.

## How much does it cost to scrape Luma events?

Pay-per-event, only for events written to your dataset:

| Event         | Price       | When                                    |
| ------------- | ----------- | --------------------------------------- |
| Event         | **$0.0025** | Every event in the dataset              |
| Event details | **$0.001**  | Only with `includeDetails` (default on) |

That's **$2.50 per 1,000 events**, or **$3.50 per 1,000** with details. The default input (20 events in New York, with details) costs $0.07. If you set a **maximum cost per run**, the actor stops cleanly when it reaches it.

## Tips for scraping Luma events

- **Bulk runs:** turn off `includeDetails` when you only need names, dates, venues, hosts and prices. It's one request per 50 events instead of one per event.
- **Weekly event feed:** schedule the actor with `onlyNew: true` so each event arrives once. Send events to Google Sheets, Slack or a webhook with Apify integrations.
- **Community leads:** run a category across several cities, then group by `calendarUrl` to get the most active communities and their hosts.
- **Find a calendar's slug:** open the community on luma.com and copy the URL into `startUrls`.

## How do I monitor Luma for new events?

Turn on `onlyNew` and run the actor on an [Apify schedule](https://docs.apify.com/platform/schedules) (e.g. daily; save the input as a task and schedule the task).

- The first run is a baseline and returns events as usual. Later runs return, and charge for, only events (by `eventId`) not returned before. Skipped events are never charged, and their details are not loaded.
- `maxEvents` counts only new events.
- State lives in your account in the key-value store `luma-events-state`, one record per input (cities, start URLs, category, keyword, calendar period). Changing any of these starts a new baseline. It remembers the latest 50,000 events.
- Add a Slack, email or webhook integration to the task to get alerts.

## Luma scraper FAQ

**Is this an official Luma API?** No. Luma's official API is for hosts managing their own calendars. This actor reads the public event data luma.com shows to logged-out visitors.

**How many events can I get per city?** Usually all upcoming events Luma lists around that city: over 1,000 for New York or San Francisco. A keyword search returns up to 50 matches per city.

**Why do I see an event from a nearby town?** City searches cover the area around the city, as on luma.com. Filter on `venueCity` or the coordinates if you need exact matches.

**Do I get attendee lists?** No. The actor outputs event data and host names only, never guest lists or attendee profiles.

**Do I need a proxy?** No. Luma's public data loads fine without one. You can turn on Apify Proxy if you ever see blocked requests.

**Can I use it through the API or with AI agents?** Yes. Call it through the Apify API, the Apify MCP server or any Apify integration.

**Disclaimer:** This actor is not affiliated with, endorsed by or sponsored by Luma. Luma is a trademark of Luma Labs, Inc. You are responsible for complying with Luma's terms and applicable laws when using the data.

## Related actors

- [Eventbrite Events Scraper](https://apify.com/cprussin/eventbrite-events?fpr=to54nm): Eventbrite events by city, category and date, with venues, organizers and prices.
- [Product Hunt Scraper](https://apify.com/cprussin/product-hunt-launches?fpr=to54nm): Product Hunt launches, leaderboards, upvotes and makers.
- [Y Combinator Scraper](https://apify.com/cprussin/ycombinator-companies?fpr=to54nm): Y Combinator company directory by batch, industry and region, plus YC startup jobs.
