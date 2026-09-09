# Stagehand + Browserbase: Image URL Download

## AT A GLANCE

- Goal: extract all image URLs from a page with Stagehand and download each image with the Browserbase Fetch API.
- SDK-backed downloads: `Browserbase.fetchAPI.create()` retrieves each discovered image through Browserbase without handwritten HTTP requests.
- Semantic URL discovery: uses `extract()` with a Zod schema to find rendered image and background-image URLs.
- Narrow DOM fallback: reads exact image URLs only when semantic extraction yields no fetchable candidates.
- Format-agnostic: uses the Fetch API response MIME type and base64 payload to save files with the correct extension (`.jpg`, `.png`, `.svg`, `.webp`, etc.).
- Organized output: images are saved to `./images/<hostname>/` so runs against different sites never mix.
  Docs → https://docs.stagehand.dev/v4/reference/page

## GLOSSARY

- Browserbase Fetch API: retrieve a discovered asset through the first-party Browserbase SDK.
  Docs → https://docs.browserbase.com/features/fetch-api
- page.evaluate: a narrow fallback that reads exact DOM asset URLs only when semantic extraction
  returns no fetchable candidates.
  Docs → https://docs.stagehand.dev/v4/reference/page
- MAX_IMAGES: configurable cap (default: 10) on how many images to download per run. Set via the `MAX_IMAGES` env var or the constant at the top of `index.ts`.

## QUICKSTART

1. cd image-url-download
2. npm install
3. cp .env.example .env
4. Add your Browserbase API key to .env
5. npm start \<url\> — e.g. `npm start https://www.browserbase.com`

## EXPECTED OUTPUT

- Initializes Stagehand session with Browserbase
- Navigates to the target URL
- Reads rendered image and inline background-image URLs from the page
- Deduplicates URLs and caps at `MAX_IMAGES` (default: 10)
- Downloads each image with the Browserbase Fetch API through the first-party TypeScript SDK
- Saves images to `./images/<hostname>/`, named `<url-segment>-<timestamp>.<ext>` with the extension derived from the real MIME type
- Logs per-image status (saved / failed) and a final summary count
- Closes session cleanly

## COMMON PITFALLS

- "Cannot find module": ensure all dependencies are installed with `npm install`
- Missing credentials: verify .env contains BROWSERBASE_API_KEY
- Empty images folder: some pages load images lazily — try scrolling the page before extraction, or increase the page load wait
- Zero images found: the page may lazy-load media or use stylesheet-only backgrounds; scroll or add target-specific selectors
- Download failures (403): some auth-gated image URLs require session cookies that the Fetch API request does not inherit
- MAX_IMAGES cap: if you need more than 10 images, set `MAX_IMAGES=50` in your .env or edit the constant at the top of `index.ts`
- Large pages: use `MAX_IMAGES` to cap the download set

## USE CASES

• Asset archiving: bulk-save product images, thumbnails, or media assets from websites you own or have permission to scrape.
• Visual regression testing: download reference images from a staging environment to diff against production.
• Dataset collection: gather labeled image sets from public pages for ML training pipelines.
• Public media: archive images discovered on pages without maintaining separate download HTTP code.

## NEXT STEPS

• Scroll before discovery: call `stagehand.act("Scroll to the bottom of the page")` to trigger lazy-loaded images.
• Concurrent downloads: fan out the Fetch API calls with `Promise.allSettled` for faster bulk downloads.
• Metadata CSV: write a `manifest.csv` alongside the images recording original URL, filename, MIME type, byte size, and download timestamp.
• Extend MIME support: add entries to the `MIME_TO_EXT` map at the top of `index.ts` for any formats not already covered.

## HELPFUL RESOURCES

📚 Stagehand Docs: https://docs.stagehand.dev/v4/first-steps/introduction
🎮 Browserbase: https://www.browserbase.com
💡 Try it out: https://www.browserbase.com/playground
🔧 Templates: https://www.browserbase.com/templates
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
