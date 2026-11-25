# Tennis Results, Fixtures & Betting Odds (ATP, WTA, ITF, doubles)

**Tennis Results, Fixtures & Betting Odds** exports **finished tennis matches with closing odds** and **upcoming matches with pre-match bookmaker odds** from [TennisExplorer](https://www.tennisexplorer.com): ATP, WTA, ATP Challenger and ITF singles, plus men's and women's doubles. Results come with set-by-set scores (tiebreaks included), winner, tournament, surface, round, seeds and the home/away closing odds. Fixtures come with the scheduled day and start time, round, seeds and the current odds. Optionally add **per-bookmaker odds** (current or closing, plus opening) and player rankings.

- ✅ **Upcoming matches with odds**: today's remaining card and up to 7 days ahead, priced, for a betting model's daily job (pull tomorrow's card, then settle it).
- ✅ **Results + odds in one row**: ready for betting models, backtests and sports analytics.
- ✅ **Any date range**: yesterday by default, or years of history (one day per request).
- ✅ **ATP, WTA, Challenger, ITF men and women, and doubles**, plus UTR/exhibition events if you want them.
- ✅ **Player mode**: the full singles match history of chosen players, with round, surface and odds.
- ✅ **Per-bookmaker odds** (bet365, Pinnacle, Betfair, 1xBet, Unibet...): current or closing prices and opening prices.
- ✅ **Monitoring**: `onlyNew` returns each result once, and in upcoming mode re-sends a fixture only when its odds move (a cheap line-movement feed).
- ✅ No login, no API key, no proxy. Polite, low-rate scraping (about 1 request per second).

## Start in one minute

Click **Start** with the prefilled input:

```json
{
  "tours": ["ATP", "WTA"],
  "maxMatches": 100
}
```

You get: Yesterday's ATP and WTA singles matches, each with `tournament`, `round`, `surface`, `player1`/`player2`, `winnerName`, `score` and closing odds (`oddsHome`, `oddsAway`). Add `"mode": "upcoming"` for the next matches instead.

**Cost:** up to $0.40: 100 matches × $0.004 (you pay only for the matches played yesterday, often fewer). No start fee.

## Use with an AI assistant

Connect the [Apify MCP server](https://mcp.apify.com) to Claude, ChatGPT, Cursor or any MCP client (`https://mcp.apify.com?tools=cprussin/tennis-matches-odds` loads only this actor), then paste:

```text
Use the Apify actor cprussin/tennis-matches-odds with mode "upcoming" to get tomorrow's ATP and Challenger matches with odds, and list the five biggest favourites.
```

## Recipes

### Tomorrow's card with per-bookmaker odds

Today's not-yet-started matches and tomorrow's matches, each with every bookmaker's current and opening price.

```json
{
  "mode": "upcoming",
  "daysAhead": 1,
  "tours": ["ATP", "WTA", "CHALLENGER"],
  "includeBookmakerOdds": true,
  "maxMatches": 200
}
```

### Odds movement feed

Schedule it every few hours: a fixture is returned again only when its odds changed since the last run; unchanged matches are skipped and free.

```json
{
  "mode": "upcoming",
  "daysAhead": 2,
  "tours": ["ATP", "WTA"],
  "includeBookmakerOdds": true,
  "onlyNew": true,
  "maxMatches": 500
}
```

### Last week's doubles results

Every men's and women's doubles match of the last 7 days, with set scores and closing odds.

```json
{
  "startDate": "7 days",
  "tours": ["ATP_DOUBLES", "WTA_DOUBLES"],
  "maxMatches": 500
}
```

### One player's season

All matches of one player since 1 January (slug from the TennisExplorer URL).

```json
{
  "playerSlugs": ["hurkacz"],
  "maxMatches": 100
}
```

### Per-bookmaker closing odds for one day

Yesterday's ATP matches with each bookmaker's opening and closing odds.

```json
{
  "startDate": "yesterday",
  "endDate": "yesterday",
  "tours": ["ATP"],
  "maxMatches": 50,
  "includeBookmakerOdds": true
}
```

## Who uses tennis results, fixtures and odds data?

- **Sports bettors and tipsters** price tomorrow's card, track line movement and backtest strategies against closing odds (closing line value, favourite/underdog ROI, surface edges).
- **Data scientists and ML engineers** build tennis prediction datasets and daily pipelines: pull upcoming fixtures with odds, predict, then settle against results.
- **Sports analytics teams and journalists** track form, upsets and surface performance.
- **Fantasy and odds-comparison sites** feed fixtures, prices and results into their products.
- **Students and researchers** study betting-market efficiency.

## How does the tennis results and fixtures scraper work?

1. **Results mode** (default): for every day in `startDate`…`endDate`, the actor loads TennisExplorer's results page for each selected list (`/results/?type=atp-single|wta-single|atp-double|wta-double&year=&month=&day=`), which lists every finished match with its closing odds.
2. **Upcoming mode** (`"mode": "upcoming"`): for today and the next `daysAhead` days it loads the matches page (`/matches/?type=…&year=&month=&day=`, same table layout, no score yet). Matches that are already live or finished are skipped.
3. It keeps the tours you asked for, then (by default) looks up **round and surface** on each tournament page, once per tournament.
4. With `includeBookmakerOdds`, it also opens each match's detail page (`/match-detail/?id=`) for the per-bookmaker odds, full player names and rankings.
5. **Player mode** (results only): set `playerSlugs` and it reads each player's yearly match list (`/player/<slug>/?annual=<year>`) instead.
6. Requests are sequential, about one per second with random jitter, with retries and exponential backoff, and an honest User-Agent. TennisExplorer's robots.txt allows these pages.

If a day genuinely has no matches (TennisExplorer says so, e.g. in the December off-season), the run succeeds with a warning. If pages can't be loaded or parsed, the run fails instead of returning an empty "success".

## How do I choose which tennis matches to scrape?

| Field                    | Description                                                                                                                                       | Example                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `mode`                   | `results` (finished matches, default) or `upcoming` (scheduled matches with pre-match odds)                                                       | `"upcoming"`            |
| `daysAhead`              | Upcoming mode: days after today, 1–7 (default 1 = today's remaining matches plus tomorrow)                                                        | `3`                     |
| `startDate`              | Results mode: first day: `YYYY-MM-DD`, `yesterday`, or relative (`"7 days"`). Empty = end date (player mode: 1 January of that year)              | `"2025-01-01"`          |
| `endDate`                | Results mode: last day (inclusive). Empty = yesterday                                                                                             | `"2025-12-31"`          |
| `tours`                  | `ATP`, `WTA`, `CHALLENGER`, `ITF_MEN`, `ITF_WOMEN`, `OTHER_MEN`, `OTHER_WOMEN`, `ATP_DOUBLES`, `WTA_DOUBLES`                                      | `["ATP", "CHALLENGER"]` |
| `playerSlugs`            | Player mode (results only): TennisExplorer player slugs or URLs                                                                                   | `["hurkacz"]`           |
| `maxMatches`             | Stop after this many matches (default 500)                                                                                                        | `10000`                 |
| `includeRoundAndSurface` | Look up round and surface on tournament pages (default `true`)                                                                                    | `true`                  |
| `includeBookmakerOdds`   | Add per-bookmaker odds, rankings and full names from each match page (default `false`; one extra request and event/match)                         | `true`                  |
| `onlyNew`                | Results: skip matches returned by earlier runs with the same tours and players. Upcoming: skip matches whose odds haven't changed since last time | `true`                  |

A full season (`"startDate": "2025-01-01"`, `"endDate": "2025-12-31"`) is about 730 results pages (two per day when you mix men's and women's tours, one more per day for each doubles list) plus one per tournament, so it takes roughly 20–30 minutes at the polite request rate. Upcoming mode reads `daysAhead + 1` pages per list.

## What data do you get for each tennis match?

One dataset item per match. A finished match (results mode):

```json
{
  "matchId": "3334240",
  "date": "2026-09-28",
  "time": "13:25",
  "tournament": "Chengdu",
  "tournamentUrl": "https://www.tennisexplorer.com/chengdu/2026/atp-men/",
  "tournamentCountry": "CN",
  "tour": "ATP",
  "surface": "hard",
  "round": "SF",
  "player1": {
    "name": "Hurkacz Hubert",
    "slug": "hurkacz",
    "country": null,
    "seed": "5",
    "rank": 41
  },
  "player2": {
    "name": "Shapovalov Denis",
    "slug": "shapovalov",
    "country": null,
    "seed": "7",
    "rank": 46
  },
  "team1": null,
  "team2": null,
  "winner": "player1",
  "winnerName": "Hurkacz Hubert",
  "setsPlayer1": 2,
  "setsPlayer2": 1,
  "setScores": [
    { "player1": 6, "player2": 7, "tiebreak": 8 },
    { "player1": 6, "player2": 3, "tiebreak": null },
    { "player1": 6, "player2": 3, "tiebreak": null }
  ],
  "score": "6-7(8) 6-3 6-3",
  "status": "completed",
  "state": "finished",
  "oddsHome": 1.61,
  "oddsAway": 2.29,
  "url": "https://www.tennisexplorer.com/match-detail/?id=3334240",
  "bookmakerOdds": [
    {
      "bookmaker": "bet-at-home",
      "oddsHome": 1.58,
      "oddsAway": 2.25,
      "openingOddsHome": 1.55,
      "openingOddsAway": 2.3
    },
    {
      "bookmaker": "Pinnacle",
      "oddsHome": 1.66,
      "oddsAway": 2.37,
      "openingOddsHome": 1.77,
      "openingOddsAway": 2.16
    }
  ]
}
```

An upcoming match (`"mode": "upcoming"`, with `includeBookmakerOdds`):

```json
{
  "matchId": "3386144",
  "scheduledDate": "2026-11-25",
  "startTime": "15:30",
  "timeZone": "GMT+1",
  "tournament": "Florianopolis challenger",
  "tournamentUrl": "https://www.tennisexplorer.com/florianopolis-challenger/2026/atp-men/",
  "tournamentCountry": "BR",
  "tour": "CHALLENGER",
  "surface": "clay",
  "round": "1R",
  "status": "scheduled",
  "state": "scheduled",
  "player1": {
    "name": "Sakamoto Pedro",
    "slug": "sakamoto-b1d5b",
    "country": null,
    "seed": null,
    "rank": 459
  },
  "player2": {
    "name": "Justo Guido Ivan",
    "slug": "justo",
    "country": null,
    "seed": "3",
    "rank": 179
  },
  "team1": null,
  "team2": null,
  "seed1": null,
  "seed2": "3",
  "oddsHome": 3.82,
  "oddsAway": 1.24,
  "sourceUrl": "https://www.tennisexplorer.com/match-detail/?id=3386144",
  "bookmakers": [
    {
      "name": "bet365",
      "home": 4,
      "away": 1.22,
      "openingHome": 4,
      "openingAway": 1.22
    },
    {
      "name": "Pinnacle",
      "home": 3.92,
      "away": 1.27,
      "openingHome": 3.85,
      "openingAway": 1.27
    }
  ]
}
```

(`bookmakerOdds`/`bookmakers`, `rank` and full names only appear with `includeBookmakerOdds`; shortened examples.)

**Field notes**

- **Odds are as displayed by TennisExplorer** (its average across bookmakers, decimal format): closing odds for finished matches, current pre-match odds for upcoming ones. `oddsHome` belongs to `player1`/`team1`, `oddsAway` to `player2`/`team2`. They are `null` when TennisExplorer shows no odds (common for low-level ITF matches and matches far ahead). Odds are not validated against any bookmaker.
- `bookmakerOdds[].oddsHome/oddsAway` (results) and `bookmakers[].home/away` (upcoming) are each bookmaker's last displayed price; `openingOdds*`/`opening*` is the earliest price in the movement history TennisExplorer shows (in upcoming mode, equal to the current price when it hasn't moved). Swapped automatically when the detail page lists the players in the other order.
- `player1` is the player TennisExplorer lists first, which is the winner on its results pages. `winner` is `"player1"`/`"player2"`.
- `status`: `completed`, `retired` (last set unfinished) or `walkover` (no games played) for results; `scheduled` for upcoming matches. Retirement is inferred from the score. `state` is `finished` or `scheduled`.
- **Doubles** (`ATP_DOUBLES`, `WTA_DOUBLES`): `team1`/`team2` hold both players of each side (name, slug, and with `includeBookmakerOdds` full name and doubles ranking). In results, `player1`/`player2` hold the team as listed ("Falck R. / Suarez B.") so the winner and score fields work as for singles; in upcoming mode `player1`/`player2` are `null` and seeds are in `seed1`/`seed2`. The doubles lists cover every level (ATP, Challenger, ITF; WTA, WTA 125, ITF).
- `tiebreak` is the losing player's tiebreak points, as shown (6-7(8) means the tiebreak was lost 8-10).
- `date`/`time` and `scheduledDate`/`startTime` are TennisExplorer's (Central European time; `timeZone` says which offset, `GMT+1` in winter and `GMT+2` in summer). Times are `null` when not set yet.
- `round`: `1R`, `2R`, `R16`, `QF`, `SF`, `F`; qualifying rounds as `Q-1R`, `Q-QF`... Empty for ITF men's matches that TennisExplorer groups under "Futures" (no tournament page).
- `tour` is derived from the tournament name for singles: "challenger" → `CHALLENGER`, "ITF"/"Futures" → `ITF_*`, UTR/exhibitions/team events → `OTHER_*`, everything else → `ATP`/`WTA` (WTA includes WTA 125 events).
- `rank` is the ranking shown on the match page, which may be the player's current ranking rather than the ranking at match time.
- `country`: only filled in player mode, for the requested player. Player mode covers singles only.

## How much does it cost to scrape tennis results, fixtures and odds?

Pay-per-event, only for what you get:

| Event                                                        | Price      |
| ------------------------------------------------------------ | ---------- |
| Match, finished or upcoming (one item in the dataset)        | **$0.004** |
| Per-bookmaker odds added to a match (`includeBookmakerOdds`) | **$0.002** |

That's **$4 per 1,000 matches**, or $6 per 1,000 with per-bookmaker odds. Filtered-out matches, already-seen results and fixtures with unchanged odds (`onlyNew`) are free, and so is a match whose detail page failed to load (it's returned without bookmaker odds, and not charged the extra event). If you set a **maximum cost per run**, the actor stops cleanly when it reaches it.

## Tips for scraping tennis results and odds

- **Daily model pipeline:** run upcoming mode each morning for the card and prices, then a results run the next day (`"startDate": "3 days"`, `"endDate": "yesterday"`, `"onlyNew": true`) to settle it. The `matchId` is the same in both.
- **Line movement:** schedule upcoming mode with `onlyNew` every few hours; each item is a new price snapshot of one match. State is kept in the key-value store `tennis-matches-odds-state` in your account, one record per tours (+ players, or + bookmaker setting in upcoming mode) combination.
- **Backfill history:** run one season at a time (`2024-01-01` to `2024-12-31`), then switch to the daily schedule.
- **Cheaper, faster runs:** set `includeRoundAndSurface: false` if you don't need them (saves one request per tournament).
- **Find a player slug:** open the player on TennisExplorer and copy the part after `/player/`, e.g. `hurkacz` or `medvedev-e0d2d`.

## Tennis matches and odds FAQ

**Where does the data come from?** Only from public TennisExplorer pages (results, matches, tournament, match and player pages). Nothing is taken from Flashscore, Livesport or any bookmaker API.

**How far back does it go?** As far as TennisExplorer's results archive (ATP/WTA results and odds go back many years; odds coverage for older and lower-level matches is thinner).

**How far ahead?** Up to 7 days (`daysAhead`). TennisExplorer usually lists the order of play a day or two ahead, so later days are often empty or unpriced until the draw is set.

**Are the odds live?** No in-play odds. Upcoming mode gives the pre-match prices at the time of the run; results give the closing odds as TennisExplorer shows them after the match.

**Can I use it through the API or with AI agents?** Yes: through the Apify API, the Apify MCP server or any Apify integration (Google Sheets, webhooks, Make, Zapier).

**Is this legal?** The actor reads publicly available pages at a low rate and respects robots.txt. You are responsible for how you use the data and for complying with TennisExplorer's terms. Gamble responsibly; this is data, not betting advice.

**Disclaimer:** This actor is not affiliated with, endorsed by or sponsored by TennisExplorer, the ATP, the WTA, the ITF or any bookmaker.

## Related actors

- [Google Trends Scraper](https://apify.com/cprussin/google-trends?fpr=to54nm): Google Trends interest over time, by region, related queries and trending searches.
- [Google Flights Scraper](https://apify.com/cprussin/google-flights-prices?fpr=to54nm): Google Flights itineraries and prices for any route and date range.
