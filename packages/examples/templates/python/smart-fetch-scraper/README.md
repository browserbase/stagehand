# Stagehand + Browserbase: Smart Fetch Scraper

Stagehand is the SDK for browser agents.

## AT A GLANCE

- Goal: scrape a webpage using the fastest method available — Fetch API first, full browser session as fallback.
- Fetch API fast-path: sends a lightweight HTTP request via `POST /v1/fetch` — no browser session, no AI credits. Returns raw HTML in milliseconds.
- Browser fallback: when the Fetch API returns insufficient or JS-rendered content, automatically falls back to a Stagehand browser session with AI-powered `extract()`.
- Fallback detection: checks status code, content length, JS-challenge patterns, and text density to decide whether the Fetch API result is usable.
- Model: uses `google/gemini-2.5-flash` for the browser fallback path.
  Docs → https://docs.stagehand.dev

## GLOSSARY

- Fetch API: Browserbase's lightweight HTTP fetching endpoint — fetches page content through Browserbase infrastructure without spinning up a browser.
  Docs → https://docs.browserbase.com/features/fetch
- extract: pull structured data from pages using schemas and AI.
  Docs → https://docs.stagehand.dev/v4/basics/extract
- Stagehand: AI browser automation framework.
  Docs → https://docs.stagehand.dev

## QUICKSTART

1. cd python/smart-fetch-scraper
2. uv pip install -e .
3. cp .env.example .env
4. Add BROWSERBASE_API_KEY to .env
5. uv run python main.py \<url\> — e.g. `uv run python main.py https://news.ycombinator.com`

## EXAMPLE URLS

Fetch API fast-path (server-rendered, returns usable HTML directly):

- `uv run python main.py https://news.ycombinator.com` — server-rendered, lightweight HTML
- `uv run python main.py https://en.wikipedia.org/wiki/Web_scraping` — static content, no JS required
- `uv run python main.py https://www.bbc.com/news` — server-rendered news page

Browser fallback (JS-rendered, blocked, or low text density):

- `uv run python main.py https://www.reddit.com` — returns a 403, triggers fallback
- `uv run python main.py https://x.com` — returns an "Enable JavaScript" shell page
- `uv run python main.py https://github.com/trending` — HTML is mostly inline scripts (3.6% text density), triggers fallback

## EXPECTED OUTPUT

- Logs the strategy being used (Fetch API vs browser)
- On Fetch API success: prints page title, link count, status code, content length, and a 500-char preview
- On browser fallback: prints Stagehand live view link, then structured JSON with page title and extracted items

## COMMON PITFALLS

- Missing credentials: verify .env contains BROWSERBASE_API_KEY
- Fetch API access: the Fetch API may require enablement on your account — contact support if you get a 404
- Content threshold: adjust MIN_CONTENT_LENGTH if server-rendered pages are incorrectly triggering the browser fallback
- Text density: adjust MIN_TEXT_DENSITY if pages with lots of inline scripts/styles are incorrectly triggering the browser fallback
- JS-challenge detection: JS_REQUIRED_PATTERNS covers common bot-detection pages (Cloudflare, etc.) — extend the list for other patterns you encounter
- Timeout: the Fetch API has a 10-second timeout and 1MB max response — very large or slow pages will need the browser path

## HELPFUL RESOURCES

📚 Browserbase Fetch Docs: https://docs.browserbase.com/features/fetch
💡 Try it out: https://www.browserbase.com/playground
🔧 Templates: https://www.browserbase.com/templates
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
