# Document to Markdown: PDF, Word, PowerPoint, Excel & EPUB for RAG

**Document to Markdown** converts **PDF, Word (DOCX), PowerPoint (PPTX), Excel (XLSX), HTML and EPUB** files into clean **Markdown**, **plain text** or **RAG-ready chunks with page numbers**. Paste a list of document links (or point it at files in an Apify key-value store) and get one tidy JSON record per document, or per chunk, ready for an LLM prompt, a vector database or a search index.

- ✅ **Six document formats, one actor**: PDF, DOCX, PPTX, XLSX, HTML and EPUB (plus CSV and TXT). The type is detected from the file itself, so download links without an extension work too.
- ✅ **Tables stay tables.** Word, Excel, PowerPoint, HTML and PDF tables become **Markdown tables**, not a jumble of words.
- ✅ **RAG chunks with page numbers.** Paragraph-aware chunks of the size you choose, with overlap, the **PDF page / slide / sheet** each chunk comes from and the **nearest heading**. Long tables are split by rows and repeat their header.
- ✅ **OCR for scanned PDFs.** Pages without a text layer are read with Tesseract (English, German, French, Spanish, Italian, Portuguese, Dutch). Pages that already have text are never OCR'd or billed.
- ✅ **Batch mode.** Thousands of URLs per run; one bad link, a 404, an oversized or unsupported file never fails the run. You get an item with the reason, for free.
- ✅ **No API keys, no LLM.** Built on Microsoft's open-source [MarkItDown](https://github.com/microsoft/markitdown): deterministic output, no per-token cost, your documents aren't sent to an AI provider.
- ✅ **Pay per document.** $4 per 1,000 documents, any size. No start fee.

## What can I use document-to-Markdown conversion for?

- **RAG and AI assistants**: turn PDFs, slide decks, manuals and reports into chunks with page numbers, embed them, and cite "page 7" in answers.
- **LLM prompts**: Markdown is the format LLMs read best. Feed whole contracts, papers or spreadsheets to ChatGPT, Claude or Gemini without copy-paste.
- **Knowledge bases and search**: index document libraries (SharePoint exports, Google Drive links, public reports) as text.
- **Data extraction**: pull tables out of PDFs, Word and Excel files as Markdown, then parse them.
- **Archiving and accessibility**: plain-text or Markdown copies of documents and e-books.
- **AI agents**: give an agent a "read this document" tool through the Apify API or MCP server.

## How does it work?

1. Each URL is downloaded (with size and time limits), or each key-value store record is read.
2. The file type is detected from its content: PDF, DOCX, PPTX, XLSX, HTML, EPUB, CSV or TXT. Legacy `.doc`/`.xls`/`.ppt`, images and other files get a clear error.
3. The document is converted with [MarkItDown](https://github.com/microsoft/markitdown). PDFs are read page by page (with table detection), so every page keeps its number; PDF pages with no text are OCR'd with [Tesseract](https://github.com/tesseract-ocr/tesseract) when OCR is on.
4. You get the Markdown, the plain text, or the chunks, with title, page count, word count and any warnings.

## How do I convert documents?

| Field                    | Description                                                                    | Default            |
| ------------------------ | ------------------------------------------------------------------------------ | ------------------ |
| `urls`                   | Document links, one per line                                                   | a sample arXiv PDF |
| `startUrls`              | Same, in Apify request-list format (combined with `urls`)                      | none               |
| `keyValueStoreRecords`   | Uploaded files, as `storeId/recordKey` or `username~store-name/recordKey`      | none               |
| `outputFormat`           | `markdown`, `text` or `chunks`                                                 | `markdown`         |
| `chunkSize`              | Max characters per chunk, overlap included (about 4 characters per token)      | `2000`             |
| `chunkOverlap`           | Characters repeated from the previous chunk                                    | `200`              |
| `ocr`                    | OCR PDF pages that have no text layer                                          | `true`             |
| `ocrLanguage`            | `eng`, `deu`, `fra`, `spa`, `ita`, `por` or `nld`                              | `eng`              |
| `maxOcrPagesPerDocument` | Cap on OCR pages per document (cost and time control)                          | `50`               |
| `maxFileSizeMb`          | Larger files are skipped with an error                                         | `50`               |
| `maxPagesPerDocument`    | Only the first pages of longer PDFs are converted                              | `1000`             |
| `timeoutSecs`            | Max download time per file                                                     | `60`               |
| `maxConcurrency`         | Parallel downloads (conversion runs one document at a time to keep memory low) | `3`                |

Example: chunk three documents for a vector database, 1,000-character chunks with 150 characters of overlap:

```json
{
  "urls": [
    "https://arxiv.org/pdf/1706.03762",
    "https://example.com/handbook.docx",
    "https://example.com/q3-results.pptx"
  ],
  "outputFormat": "chunks",
  "chunkSize": 1000,
  "chunkOverlap": 150
}
```

**Converting your own files:** upload them to a key-value store in your Apify account (Storage → Key-value stores → your store → upload a record) and list them in `keyValueStoreRecords`, e.g. `my-user~contracts/lease.pdf`. Private record URLs (`https://api.apify.com/v2/key-value-stores/.../records/...`) also work in `urls`; the actor reads them with your run's token.

## What data do you get?

**Markdown or text** (`outputFormat: "markdown"` or `"text"`): one item per document (shortened):

```json
{
  "url": "https://arxiv.org/pdf/1706.03762",
  "fileName": "1706.03762v7.pdf",
  "fileType": "pdf",
  "title": null,
  "outputFormat": "markdown",
  "content": "Attention Is All You Need\n\nAshish Vaswani∗\nGoogle Brain\n...\n\n| ByteNet[18] | 23.75 | | | |\n| ConvS2S[9] | 25.16 | 40.46 | 9.6·1018 | 1.5·1020 |\n...",
  "pageCount": 15,
  "ocrPages": 0,
  "bytes": 2215244,
  "charCount": 39854,
  "wordCount": 5282,
  "contentUrl": null,
  "warning": null,
  "error": null,
  "convertedAt": "2026-10-06T13:20:00.000Z"
}
```

**RAG chunks** (`outputFormat: "chunks"`): one item per chunk, with the same document fields plus:

```json
{
  "chunkIndex": 12,
  "chunkCount": 41,
  "pageStart": 5,
  "pageEnd": 6,
  "heading": null,
  "content": "...instead of performing a single attention function with dmodel-dimensional keys, values and queries...",
  "charCount": 1486
}
```

- `pageStart`/`pageEnd` are **PDF page numbers**, **PPTX slide numbers** or **XLSX sheet numbers**. DOCX, HTML and EPUB have no fixed pages, so they are `null`.
- `heading` is the nearest Markdown heading above the chunk (DOCX, HTML and EPUB headings, slide titles, sheet names). PDFs carry no heading structure, so for PDFs it is `null`.
- Each item has a `title` from the document's metadata or its first heading, when available.
- Content over 5 MB (very long books) is saved to the run's key-value store and linked in `contentUrl`; the item holds the first million characters.
- Failed documents are returned with `content: null` and an `error`, such as `Download failed: HTTP 404 Not Found.`, `The file is 80 MB, over the 50 MB limit (maxFileSizeMb).`, `The PDF is password-protected.` or `Legacy Office format (.doc, .xls or .ppt) is not supported.`

## How much does it cost to convert documents to Markdown?

Pay per event, no subscription and no start fee:

| Event                                            | Price                     |
| ------------------------------------------------ | ------------------------- |
| Document converted (any size, any chunk count)   | **$0.004** ($4 per 1,000) |
| OCR page (scanned PDF page, only when OCR is on) | **$0.01** ($10 per 1,000) |

Failed documents are free, and pages that already have text are never billed as OCR. A 300-page text PDF costs $0.004; a 10-page scanned PDF costs $0.004 + 10 × $0.01 = $0.104. Compute is included. If you set a **maximum cost per run**, the actor stops cleanly when it's reached and never starts OCR it can't bill.

## Tips

- **Chunk size**: 1,000-2,000 characters (250-500 tokens) suits most embedding models. Use 10-15% overlap.
- **Scanned PDFs**: keep OCR on and pick the document's language. Mixed PDFs (some scanned pages) are fine: only the image-only pages are OCR'd. Turn OCR off to skip scans entirely; the item's `warning` then says how many pages had no text.
- **Big files**: the default 1 GB memory handles typical documents up to 50 MB. For larger files, raise `maxFileSizeMb` and the run memory (2-4 GB).
- **Google Docs, Sheets and Slides**: use their export links, e.g. `https://docs.google.com/document/d/<id>/export?format=docx` (the file must be shared publicly).
- **Web pages**: HTML pages convert too, but for crawling whole websites use a crawler such as Website Content Crawler.

## FAQ

**Which formats are supported?** PDF, DOCX, PPTX, XLSX, HTML, EPUB, CSV and TXT/Markdown. Legacy binary Office files (`.doc`, `.xls`, `.ppt`), images, audio and ZIP archives are not; you get a free error item.

**How good is the table extraction?** Tables in DOCX, XLSX, PPTX, HTML and EPUB are converted exactly. PDF tables are detected from word positions (PDFs don't store tables), which works well for clean, ruled tables and less well for complex multi-level headers.

**Does it use AI or send my documents anywhere?** No. Conversion runs entirely inside the actor with open-source tools. No LLM, no API keys, no third-party services.

**Can I convert password-protected PDFs?** No. They return a free error item.

**What about math, images and charts?** Text and tables are extracted; images and charts are not described (no LLM). Math in PDFs comes out as plain characters.

**Can AI agents use it?** Yes, through the Apify API, the Apify MCP server or any Apify integration (Make, Zapier, n8n, LangChain, LlamaIndex).

**Disclaimer:** You are responsible for having the right to process the documents you submit.

## Open-source software

This actor is built on [MarkItDown](https://github.com/microsoft/markitdown) (MIT License, © Microsoft Corporation) and [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) (Apache License 2.0). See `THIRD_PARTY_NOTICES.md` in the source for all notices. It is not affiliated with or endorsed by Microsoft or the Tesseract project.

## Related actors

- [youtube-transcripts](https://apify.com/cprussin/youtube-transcripts?fpr=to54nm): YouTube transcripts as text, segments, SRT or VTT, for AI and RAG.
- [website-screenshot](https://apify.com/cprussin/website-screenshot?fpr=to54nm): Full-page or viewport screenshots and PDFs of any URL.
- [substack-scraper](https://apify.com/cprussin/substack-scraper?fpr=to54nm): Substack newsletter posts, content and public stats.
