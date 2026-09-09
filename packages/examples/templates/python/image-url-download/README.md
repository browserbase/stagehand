# Stagehand + Browserbase: Image URL Download

Stagehand is the SDK for browser agents.

## AT A GLANCE

- Goal: extract all image URLs from a page with Stagehand and download each image with the Browserbase Fetch API.
- SDK-backed downloads: `AsyncBrowserbase.fetch_api.create()` retrieves each discovered image through Browserbase without handwritten HTTP requests.
- AI-powered URL extraction: uses `extract()` with a JSON schema to reliably pull `<img>` src attributes and background image URLs from any page.
- Format-agnostic: uses the `Content-Type` response header to detect the real MIME type — files are saved with the correct extension (`.jpg`, `.png`, `.svg`, `.webp`, etc.).
- Organized output: images are saved to `./images/<hostname>/` so runs against different sites never mix.
- V4 page access: the Python SDK exposes the active Stagehand page directly for navigation; URL discovery remains an `extract()` operation.
  Docs → https://docs.stagehand.dev/v4/basics/extract

## GLOSSARY

- extract: pull structured data from a page using a natural language instruction and a JSON schema.
  Docs → https://docs.stagehand.dev/v4/basics/extract
- Browserbase Fetch API: retrieve a discovered asset through the first-party Browserbase SDK.
  Docs → https://docs.browserbase.com/features/fetch-api
- page.evaluate: a narrow fallback that reads exact DOM asset URLs only when semantic extraction
  returns no fetchable candidates.
  Docs → https://docs.stagehand.dev/v4/reference/page
- ImageUrls: Pydantic schema passed to `extract()` for typed URL discovery.
- MAX_IMAGES: configurable cap (default: 10) on how many images to download per run. Set via the `MAX_IMAGES` env var or the constant at the top of `main.py`.

## QUICKSTART

1. cd image-url-download
2. cp .env.example .env
3. Add BROWSERBASE_API_KEY to .env
4. uv run main.py \<url\> — e.g. `uv run main.py https://www.browserbase.com`

## EXPECTED OUTPUT

- Initializes Stagehand session with Browserbase
- Connects Playwright to the same session via CDP
- Navigates to the target URL and waits for the page to fully render
- Extracts all image URLs from the page using `extract()`
- Deduplicates URLs and caps at `MAX_IMAGES` (default: 10)
- Downloads each image with the Browserbase Fetch API through the first-party Python SDK
- Saves images to `./images/<hostname>/`, named `<url-segment>-<timestamp>.<ext>` with the extension derived from the `Content-Type` header
- Logs per-image status (saved / failed) and a final summary count
- Closes session cleanly

## COMMON PITFALLS

- `ModuleNotFoundError`: ensure all dependencies are installed — `uv run` handles this automatically via `pyproject.toml`
- Missing credentials: verify .env contains BROWSERBASE_API_KEY
- Zero images found: the page may load images lazily or use CSS background images — try scrolling before extraction with `stagehand.act()`, or refine the extract instruction
- Download failures (403): some auth-gated image URLs require session cookies that the Fetch API request does not inherit
- MAX_IMAGES cap: if you need more than 10 images, set `MAX_IMAGES=50` in your .env or edit the constant at the top of `main.py`
- Large pages: pages with hundreds of images may slow down `extract()` — use MAX_IMAGES to limit the download set

## USE CASES

• Asset archiving: bulk-save product images, thumbnails, or media assets from websites you own or have permission to scrape.
• Visual regression testing: download reference images from a staging environment to diff against production.
• Dataset collection: gather labeled image sets from public pages for ML training pipelines.
• Public media: archive images discovered on pages without maintaining separate download HTTP code.

## NEXT STEPS

• Scroll before extracting: use `stagehand.act()` to scroll the page before `extract()` to trigger lazy-loaded images.
• Concurrent downloads: fan out the Fetch API calls with `asyncio.gather()` for faster bulk downloads.
• Metadata CSV: write a `manifest.csv` alongside the images recording original URL, filename, MIME type, byte size, and download timestamp.
• Extend MIME support: add entries to the `MIME_TO_EXT` dict at the top of `main.py` for any formats not already covered.

## HELPFUL RESOURCES

📚 Stagehand Docs: https://docs.stagehand.dev/v4/first-steps/introduction
🎮 Browserbase: https://www.browserbase.com
💡 Try it out: https://www.browserbase.com/playground
🔧 Templates: https://www.browserbase.com/templates
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
