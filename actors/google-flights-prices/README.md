# Google Flights Scraper: Prices, Itineraries & Date Ranges

**Google Flights Scraper** exports flight prices and itineraries from Google Flights as clean JSON, CSV or Excel. Google has no public flights API (QPX Express was shut down in 2018), so this actor reads the same results the google.com/travel/flights website shows:

- ✅ **Prices** for any route and date, in any currency and point-of-sale country.
- ✅ **Itinerary details**: airlines, flight numbers, local departure/arrival times, total duration, stops, layover airports and layover times, aircraft and legroom per leg.
- ✅ **CO2 emissions** per itinerary and vs the typical emissions for the route, when Google shows them.
- ✅ **Best / cheapest flags**: `isBest` marks Google's "Top flights", `isCheapest` the lowest price of each search.
- ✅ **One-way or round trip**, 1–9 adults, economy, premium economy, business or first, and a nonstop / max-stops filter.
- ✅ **Date ranges** per route (price-calendar style): one search per departure day, with an optional fixed stay length for round trips.
- ✅ Handles Google's rate limits: new proxy IP on every blocked or failed request, direct fallback when the proxy is down, capped retry time.
- ✅ Fast and light: plain HTTP requests, no browser. Pay only for itineraries written to your dataset.

## Who uses Google Flights price data?

- **Travel startups and OTAs**: price benchmarks and route coverage without a GDS contract.
- **Fare alert and deal sites**: schedule daily runs and alert on price drops for watched routes.
- **Travel managers and agencies**: compare fares across dates, cabins and airlines before booking.
- **Airlines and airports**: monitor competitors' fares and schedules on shared routes.
- **Analysts, researchers and journalists**: track airfare trends and emissions over time.
- **AI agents**: give an LLM live flight prices through the Apify API or MCP server.

## How does the Google Flights price scraper work?

1. Add routes: origin and destination IATA codes and a date (or a date range).
2. Choose passengers, cabin, stops, currency and country.
3. The actor loads the Google Flights results page for each route and date and reads the itinerary data embedded in it (the same data the page renders).
4. You get one dataset item per itinerary, in Google's order: top flights first, then the other flights. Up to `maxItineraries` per search.

## How do I set up flight routes and dates?

| Field                | Description                                                                           | Example                                                    |
| -------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `routes`             | List of routes (see below)                                                            | `[{"origin": "JFK", "destination": "LHR", "date": "+30"}]` |
| `adults`             | Adult passengers, 1–9. Prices are the total for all passengers                        | `2`                                                        |
| `cabinClass`         | `economy`, `premiumEconomy`, `business` or `first`                                    | `"business"`                                               |
| `maxStops`           | `any`, `0` (nonstop), `1` or `2`                                                      | `"0"`                                                      |
| `maxItineraries`     | Max itineraries per route and date (Google lists up to ~30 per search)                | `10`                                                       |
| `currency`           | ISO currency code                                                                     | `"EUR"`                                                    |
| `country`            | Point-of-sale country (Google's `gl`)                                                 | `"DE"`                                                     |
| `language`           | Interface language (`hl`) for airport and airline names                               | `"en"`                                                     |
| `onlyNew`            | Monitoring: only itineraries that are new or whose price changed since an earlier run | `true`                                                     |
| `proxyConfiguration` | Apify Proxy (on by default; datacenter is enough)                                     | `{ "useApifyProxy": true }`                                |

Each route has:

- `origin`, `destination`: 3-letter IATA airport or city codes (`JFK`, `LHR`, `NYC`, `LON`).
- `date`: `YYYY-MM-DD`, or `+N` for N days from today (handy for scheduled runs). Default `+30`.
- `returnDate`: for a round trip on one date.
- `dateFrom` + `dateTo`: search every departure day in the range (up to 180 days), instead of `date`.
- `stayDays`: round trip returning N days after each departure date; works with ranges.

A route can also be a string: `"JFK-LHR 2026-11-15"` or `"JFK-LHR 2026-11-15 2026-11-22"` (round trip).

Example: the cheapest week-long round trip from LA to Tokyo departing any day in the first week of December, nonstop only.

```json
{
  "routes": [
    {
      "origin": "LAX",
      "destination": "NRT",
      "dateFrom": "2026-12-01",
      "dateTo": "2026-12-07",
      "stayDays": 7
    }
  ],
  "maxStops": "0",
  "maxItineraries": 3
}
```

## What data do you get for each flight?

```json
{
  "route": "JFK-LHR",
  "origin": "JFK",
  "destination": "LHR",
  "tripType": "oneWay",
  "departureDate": "2026-11-15",
  "returnDate": null,
  "adults": 1,
  "cabinClass": "economy",
  "price": 291,
  "currency": "USD",
  "isBest": false,
  "isCheapest": true,
  "rank": 6,
  "airlines": ["Icelandair"],
  "flightNumbers": ["FI614", "FI450"],
  "departureAirport": "JFK",
  "arrivalAirport": "LHR",
  "departureTime": "2026-11-15T19:25",
  "arrivalTime": "2026-11-16T10:50",
  "durationMinutes": 625,
  "duration": "10h 25m",
  "stops": 1,
  "layoverAirports": ["KEF"],
  "layovers": [
    {
      "airport": "KEF",
      "airportName": "Keflavík International Airport",
      "city": "Reykjavík",
      "durationMinutes": 85
    }
  ],
  "legs": [
    {
      "flightNumber": "FI614",
      "airline": "Icelandair",
      "airlineCode": "FI",
      "from": "JFK",
      "fromName": "John F. Kennedy International Airport",
      "to": "KEF",
      "toName": "Keflavík International Airport",
      "departureTime": "2026-11-15T19:25",
      "arrivalTime": "2026-11-16T06:10",
      "durationMinutes": 345,
      "aircraft": "Boeing 737MAX 9 Passenger",
      "legroom": "30 in"
    }
  ],
  "emissionsKg": 466,
  "typicalEmissionsKg": 431,
  "emissionsDiffPercent": 8,
  "searchUrl": "https://www.google.com/travel/flights/search?tfs=GhoSCjIwMjYtMTEtMTVqBRIDSkZLcgUSA0xIUkABSAGYAQI%3D&hl=en&gl=us&curr=USD",
  "scrapedAt": "2026-09-30T20:00:00.000Z"
}
```

- Times are **local airport times** (`YYYY-MM-DDTHH:mm`, no time zone), like on the website.
- `price` is the total for all passengers. For round trips it's the **round-trip** price, and the itinerary fields describe the **outbound** flights (as on Google's first results page).
- `rank` is the position in Google's list for that search. `searchUrl` opens the same search in a browser.
- Emission fields are `null` when Google has no estimate for that flight.

## How much does it cost to scrape Google Flights prices?

Pay-per-event, only for itineraries written to your dataset:

| Event            | Price      |
| ---------------- | ---------- |
| Flight itinerary | **$0.005** |

That's **$5 per 1,000 itineraries**. The default input (one route, 10 itineraries) costs $0.05. A 30-day price calendar with the 3 best itineraries per day is 90 itineraries, $0.45. Searches that return no flights are free. If you set a **maximum cost per run**, the actor stops cleanly when it reaches it.

## Tips for tracking Google Flights prices

- **Cheapest day to fly:** use `dateFrom`/`dateTo` with `maxItineraries: 1–3`, then sort by `price` or filter `isCheapest: true`.
- **Price tracking:** schedule the actor daily with relative dates (`"+30"`, `"+60"`) and compare prices over time, or send new results to Google Sheets, Slack or a webhook with Apify integrations.
- **City codes** (`NYC`, `LON`, `PAR`, `TYO`) search all airports of a city at once.
- **Lower cost per search:** Google puts its recommended "top flights" first, so a small `maxItineraries` still gets the most relevant options.

## How do I monitor Google Flights for new items?

Turn on `onlyNew` and run the actor on an [Apify schedule](https://docs.apify.com/platform/schedules) (e.g. every few hours or daily; save the input as a task and schedule the task).

- The first run is a baseline and returns itineraries as usual. Later runs return, and charge for, only itineraries that are new or whose `price` changed. Unchanged itineraries are skipped and never charged.
- An itinerary is identified by route, dates, passengers, cabin, flight numbers and departure time. It watches the top `maxItineraries` per search.
- Fixed dates suit price-change alerts best. With relative dates (`"+30"`) each day is a new date, so its itineraries are new.
- State lives in your account in the key-value store `google-flights-prices-state`, one record per combination of routes, passengers, cabin, stops, currency and country (not dates). Changing any of these starts a new baseline. It remembers the latest 50,000 itineraries.
- Add a Slack, email or webhook integration to the task to get price alerts.

## Google Flights scraper FAQ

**Is this an official Google API?** No. It reads the public results that google.com/travel/flights shows. Prices match what you see in the browser for the same search, country and currency.

**Why do prices differ from my browser?** Fares change constantly, and Google shows different prices by point-of-sale country and currency. Set `country` and `currency` to match your browser.

**Why at most ~30 itineraries per search?** That's what Google's results page lists before you click "View more flights". Use `maxStops` or date ranges to explore more options.

**Can I get the return flights of a round trip?** Not yet. Round trips return the outbound options with the total round-trip price. Search the return leg as a separate one-way route if you need its flights.

**Do I need a proxy?** Google occasionally rate-limits single IPs. Apify Proxy (datacenter) is enabled by default, and the actor switches IP automatically when a request is blocked.

**Can I use it through the API or with AI agents?** Yes. Call it through the Apify API, the Apify MCP server or any Apify integration.

**Disclaimer:** This actor is not affiliated with, endorsed by or sponsored by Google. Google Flights is a trademark of Google LLC. You are responsible for complying with Google's terms when using the data.

## Related actors

- [aliexpress-scraper](https://apify.com/cprussin/aliexpress-scraper): AliExpress product search results, prices and buyer reviews.
- [google-trends](https://apify.com/cprussin/google-trends): Google Trends interest over time, regions, related queries and trending searches.
- [eventbrite-events](https://apify.com/cprussin/eventbrite-events): Eventbrite events by city, category and date, with venues, organizers and prices.
