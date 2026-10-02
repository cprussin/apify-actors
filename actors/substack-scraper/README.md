# Substack Scraper: Newsletter Posts, Content & Stats

**Substack Scraper** downloads posts from any **Substack newsletter**, on a `name.substack.com` subdomain or a **custom domain**. For each post you get the title, subtitle, date, free or paid audience, post type (newsletter, podcast, thread), likes, comments, restacks, word count, authors, cover image and tags. Optionally you also get the **full post body as HTML and clean plain text**. Paste publication URLs, subdomains or post links. No login or API key needed.

- ✅ **Any publication:** `lenny`, `lenny.substack.com`, `www.lennysnewsletter.com`, `https://open.substack.com/pub/lenny/p/...` or a single post URL.
- ✅ **Engagement stats:** likes (reactions), comment count, restacks and word count for every post.
- ✅ **Full text for AI and research:** `bodyHtml` plus readable `bodyText`, ready for LLMs, RAG, summarization or sentiment analysis.
- ✅ **Honest about paywalls:** paid posts include only the public preview Substack shows to everyone, marked `truncated: true`. Paywalled content is never bypassed.
- ✅ **Delta mode:** set `sinceDate` (e.g. `"7 days"`) and the run stops at older posts, so scheduled runs only pay for new posts.
- ✅ **Keyword search** inside each publication's archive.
- ✅ Fast and light: uses Substack's public JSON endpoints. No browser, no proxy needed.
- ✅ Pay only per post returned. Two simple prices: metadata only, or metadata plus content.

## Who uses Substack post data?

- **Marketers and growth teams** find the best-performing topics and headlines in their niche by likes and comments.
- **Newsletter writers** benchmark against competing Substacks: posting cadence, length, free vs. paid mix.
- **Sponsors and agencies** vet newsletters before buying ads, and monitor where competitors sponsor.
- **Researchers, journalists and analysts** archive and analyze what influential writers publish.
- **AI and data teams** build datasets of long-form writing for training, retrieval (RAG) or LLM summaries.
- **Investors and PR teams** track what is said about a company, sector or person across newsletters, using keyword search.

## How does the Substack scraper work?

1. Add publications or posts. Any of these work:
   - Subdomain: `lenny` or `lenny.substack.com`
   - Custom domain: `www.lennysnewsletter.com`
   - Post URL: `https://www.lennysnewsletter.com/p/some-post` (scrapes just that post)
2. Pick how many posts per publication, whether you want the post content, and optional filters.
3. The actor pages through each publication's archive, newest first, via Substack's public API (`/api/v1/archive`). With content on, it loads each post (`/api/v1/posts/<slug>`). Rate limits and network errors are retried with backoff. Duplicates are removed.
4. A publication that doesn't exist, or a site that isn't on Substack, is logged and skipped. The rest of the run continues.

## How do I choose which Substack newsletters to scrape?

| Field                    | Description                                                                                 | Example                               |
| ------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------- |
| `publications`           | Substack subdomains, custom domains, publication URLs or post URLs                          | `["lenny", "www.astralcodexten.com"]` |
| `maxPostsPerPublication` | Stop after this many posts per publication (newest first)                                   | `100`                                 |
| `includeContent`         | Also return `bodyHtml` + `bodyText` (paid posts: public preview only)                       | `true`                                |
| `sinceDate`              | Only posts on or after this date: `YYYY-MM-DD`, ISO timestamp, or `"7 days"`, `"1 month"`   | `"30 days"`                           |
| `search`                 | Only posts matching a keyword, using the publication's own archive search                   | `"pricing"`                           |
| `onlyNew`                | Monitoring: only posts not returned by an earlier run with the same publications and search | `true`                                |
| `proxyConfiguration`     | Optional Apify Proxy. Not needed normally                                                   | `{ "useApifyProxy": false }`          |

Example: every post from the last 30 days of three newsletters, with full text.

```json
{
  "publications": [
    "https://www.lennysnewsletter.com",
    "astralcodexten.substack.com",
    "https://www.noahpinion.blog"
  ],
  "includeContent": true,
  "sinceDate": "30 days",
  "maxPostsPerPublication": 200
}
```

## What data do you get for each Substack post?

One dataset item per post. Example (paid post with content, shortened):

```json
{
  "publication": "www.lennysnewsletter.com",
  "publicationName": "Lenny's Newsletter",
  "postId": 216168140,
  "title": "Advanced evals: How to find (and fix) hidden AI failures in your product",
  "subtitle": "Why you should never skip error discovery",
  "slug": "advanced-evals-how-to-find-and-fix",
  "url": "https://www.lennysnewsletter.com/p/advanced-evals-how-to-find-and-fix",
  "postDate": "2026-09-22T12:45:14.998Z",
  "audience": "paid",
  "type": "newsletter",
  "likes": 330,
  "restacks": 16,
  "commentCount": 4,
  "wordcount": 3807,
  "authors": [
    { "id": 2260358, "name": "Hamel Husain", "handle": "hamelhusain" },
    { "id": 58144420, "name": "Shreya Shankar", "handle": "shreyashan" }
  ],
  "coverImage": "https://substackcdn.com/image/fetch/.../6f6018cf-fa53-4f40-99d9-b1c9980dd031_1456x970.png",
  "section": null,
  "tags": ["AI"],
  "bodyHtml": "<p><em><span>👋 Hey there, I’m Lenny. …",
  "bodyText": "👋 Hey there, I’m Lenny. Each week, I share deeply researched product, growth, and career advice. …",
  "truncated": true
}
```

**Field notes**

- `publication` is the publication's host (its custom domain if it has one). `publicationName` is its display name.
- `postDate` is an ISO 8601 UTC timestamp.
- `audience`: `free` (everyone can read it) or `paid` (paid subscribers only, including founding-member posts).
- `type`: as reported by Substack, usually `newsletter`, `podcast` or `thread`.
- `likes` is Substack's reaction (heart) count. `restacks` is how often the post was shared on Substack Notes.
- `wordcount` is Substack's count for the whole post, including the paywalled part.
- `bodyHtml`, `bodyText` and `truncated` are `null` unless `includeContent` is on.
- `truncated: true` means the body is the public preview of a paid post, not the full article. Free posts return the full public body.

## How much does it cost to scrape Substack?

Pay-per-event. You are charged **one** event per post, never both:

| Event                                      | Price       | Per 1,000 posts |
| ------------------------------------------ | ----------- | --------------- |
| Post (metadata only, `includeContent` off) | **$0.0015** | $1.50           |
| Post with content (`includeContent` on)    | **$0.003**  | $3.00           |

Posts that fail to load, duplicates and filtered-out posts are not charged. If you set a **maximum cost per run**, the actor stops cleanly when it reaches it.

## Tips for scraping Substack newsletters

- **Weekly digest:** schedule the actor with `sinceDate: "7 days"` and send the dataset to Google Sheets, Slack or email with Apify integrations.
- **Top posts:** run with a high `maxPostsPerPublication` and sort the results by `likes` or `commentCount`.
- **Save money:** leave `includeContent` off if you only need titles, dates and stats.
- **LLM-ready text:** use `bodyText` (clean paragraphs, no HTML) and filter out `truncated: true` if you only want complete articles.
- **Keyword search** results come in relevance order, not by date. The `sinceDate` filter still applies.

## How do I monitor Substack for new items?

Turn on `onlyNew` and run the actor on an [Apify schedule](https://docs.apify.com/platform/schedules) (e.g. daily; save the input as a task and schedule the task).

- The first run is a baseline and returns posts as usual. Later runs return, and charge for, only posts (by `postId`) not returned before. Skipped posts are never charged, and their content is not downloaded.
- Each publication's archive is read newest first and stops after 3 known posts in a row, so a quiet day costs almost nothing and older posts the baseline did not reach are not returned as new. `maxPostsPerPublication` counts only new posts.
- State lives in your account in the key-value store `substack-scraper-state`, one record per combination of publications and search. Changing either starts a new baseline. It remembers the latest 50,000 posts.
- Add a Slack, email or webhook integration to the task to get alerts.

## Substack scraper FAQ

**Can it scrape paid (paywalled) posts?** It returns all metadata for paid posts, and the same public preview that any visitor sees, flagged with `truncated: true`. It does not log in and does not bypass Substack paywalls. To read full paid posts, subscribe to the newsletter.

**Does it work with custom domains?** Yes. Any Substack publication on its own domain works, e.g. `www.lennysnewsletter.com`. Subdomains that redirect to a custom domain are followed automatically.

**How many posts can I get?** The full public archive of a publication. `maxPostsPerPublication` caps each one.

**Does it scrape comments, Notes or subscriber lists?** No. It collects published posts and their public stats (comment count included). It never collects email addresses or subscriber data.

**Do I need a proxy?** No. It makes a few light requests per page of 50 posts. A proxy option is there for very large runs if Substack ever rate-limits.

**Can I use it through the API or with AI agents?** Yes. Call it through the Apify API, the Apify MCP server or any Apify integration. Pricing is per event only.

**Is scraping Substack legal?** The actor only collects publicly available data that Substack serves to every visitor. Posts are copyrighted by their authors: you are responsible for how you use the content (e.g. quoting, republishing, AI training) and for complying with Substack's terms and applicable law.

**Disclaimer:** This actor is not affiliated with, endorsed by or sponsored by Substack Inc. Substack is a trademark of Substack Inc.

## Related actors

- [telegram-channel-scraper](https://apify.com/cprussin/telegram-channel-scraper): Posts, views and reactions from public Telegram channels.
- [youtube-transcripts](https://apify.com/cprussin/youtube-transcripts): Captions and transcripts from YouTube videos and channels.
- [bilibili-scraper](https://apify.com/cprussin/bilibili-scraper): Bilibili videos, comments, trending and search results.
