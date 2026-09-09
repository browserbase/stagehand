# Stagehand + Browserbase: Website Link Tester (Python)

Stagehand is the SDK for browser agents.

## AT A GLANCE

- **Goal**: Crawl a website’s homepage, collect all links, and verify that each link loads successfully and matches its link text.
- **Link extraction**: Uses `page.extract()` with a Pydantic schema to pull all links and their visible text from the homepage.
- **Content verification**: Opens each link and uses AI to assess whether the page content matches what the link text suggests.
- **Social link handling**: Detects social media domains and only checks that they load (skipping full content verification).
- **Batch processing**: Processes links in batches controlled by `MAX_CONCURRENT_LINKS` (sequential by default, can be made concurrent).

## GLOSSARY

- **Stagehand (Python v2)**: Python client that wraps AI-powered browser automation on top of Browserbase.
  Docs → `https://docs.stagehand.dev/v4/sdk/python`
- **extract**: Extract structured data from web pages using natural language instructions and Pydantic models.
  Docs → `https://docs.stagehand.dev/v4/basics/extract`
- **concurrent sessions**: Run multiple browser sessions at the same time for faster batch processing.
  Docs → `https://docs.browserbase.com/guides/concurrency-rate-limits`

## QUICKSTART

1. **cd into the template**
   - `cd python/website-link-tester`
2. **Create & activate a virtual environment (optional but recommended)**
   - `uv venv venv`
   - `source venv/bin/activate` (macOS/Linux)
     `venv\Scripts\activate` (Windows)
3. **Install dependencies with uvx**
   - `uvx install stagehand python-dotenv pydantic`
4. **Configure environment**
   - Ensure your `.env` file (at repo root or in this folder) contains:
     - `BROWSERBASE_API_KEY`
5. **Run the script**
   - `python main.py`

## EXPECTED OUTPUT

- **Initial setup**
  - Initializes a Stagehand session with Browserbase.
  - Prints a live session link for monitoring the browser in real time (when available).
- **Link collection**
  - Navigates to the configured `URL` (default: `https://www.browserbase.com`).
  - Extracts all links and their link text from the homepage using a Pydantic schema.
  - Logs total link count and unique link count after de-duplication.
- **Verification**
  - Verifies links in batches using `MAX_CONCURRENT_LINKS`.
  - For each link:
    - Confirms the page loads successfully.
    - For non-social links, extracts:
      - `page_title`
      - `content_matches` (boolean)
      - short `assessment` (max ~8 words)
    - For social links, confirms load and skips detailed content checks.
- **Final report**
  - Prints a JSON summary including:
    - total links
    - successful vs failed checks
    - per-link details (title, match flag, assessment, and any errors)
  - Always closes browser sessions cleanly via context managers.

## COMMON PITFALLS

- **Missing credentials**
  - Ensure `.env` contains `BROWSERBASE_API_KEY`.
- **Concurrency limits**
  - `MAX_CONCURRENT_LINKS > 1` will open multiple browsers in parallel and requires a Browserbase plan that supports concurrency (Startup or Developer or higher).
- **Slow or failing pages**
  - Some links may be slow, geo-restricted, or require auth/consent; these can produce timeouts or error messages in the results.
- **Dynamic or JS-heavy sites**
  - Heavily scripted pages might take longer to reach `"domcontentloaded"`; adjust timeouts if needed.
- **Social / external redirects**
  - Social links and complex redirect chains may succeed in loading but not be fully verifiable for content; these are marked as special cases.

## USE CASES

- **Regression testing**: Quickly verify that all key marketing and product links on your homepage still resolve correctly after a deployment.
- **Content QA**: Detect mismatches between link text and destination page content (e.g., wrong page wired to a CTA).
- **SEO and UX audits**: Find broken or misdirected links that can harm search rankings or user experience.
- **Monitoring**: Run this periodically to flag link issues across your marketing site or documentation hub.

## TUNING BATCH SIZE & CONCURRENCY

- **`MAX_CONCURRENT_LINKS` in `main.py`**
  - Default: `1` → sequential link verification (works on all plans).
  - Set to `> 1` → more concurrent link verifications per batch (requires higher Browserbase concurrency limits).
- **Using Semaphores for advanced control**
  - For more fine-grained control over concurrency (e.g., rate limiting, prioritization, or per-domain limits), you can wrap link verification in a **Semaphore** or similar concurrency primitive.
  - This lets you:
    - Cap how many verifications run at once.
    - Smooth out spikes in resource usage.
    - Apply different limits for external vs internal links if desired.

## NEXT STEPS

- **Filter link scopes**: Limit verification to specific path prefixes (e.g., only `/docs` or `/blog`) or exclude certain domains.
- **Recursive crawling**: Start from the homepage, follow internal links to secondary/tertiary pages, and cascade link discovery deeper into the site to build a more complete link map.
- **Alerting & monitoring**: Integrate with Slack, email, or logging tools to notify when links start failing.
- **CI integration**: Run this in CI and fail builds when a critical link (e.g., signup, pricing, docs) breaks.
- **Richer assessments**: Expand the extraction schema to capture additional metadata (e.g., HTTP status code, canonical URL, or key headings).

## HELPFUL RESOURCES

- 📚 **Stagehand Docs**: `https://docs.stagehand.dev/v4/first-steps/introduction`
- 🎮 **Browserbase**: `https://www.browserbase.com`
- 💡 **Try it out**: `https://www.browserbase.com/playground`
- 🔧 **Templates**: `https://www.browserbase.com/templates`
- 📧 **Need help?**: `support@browserbase.com`
- 💬 **Discord**: `http://stagehand.dev/discord`
