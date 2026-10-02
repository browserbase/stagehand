# Export a paginated book catalog

Collect every book from Books to Scrape with Stagehand `extract()`, `observe()`, and `act()`. The output is `out/catalog.json` with `pages`, `count`, and `books`.

Set `BROWSERBASE_API_KEY` and `OPENAI_API_KEY` in each language's `.env`. To use Browserbase Model Gateway instead, set `MODEL_PROVIDER=gateway` and omit `OPENAI_API_KEY`. `MAX_PAGES` defaults to 50 and fails before writing a partial catalog if reached. `CATALOG_URL` defaults to `https://books.toscrape.com/`.

Run from a language folder after copying `.env.example` to `.env`:

- TypeScript: `pnpm install && pnpm start`
- Python: `uv sync && uv run python main.py`
- Go: `set -a; . ./.env; set +a; go run .`

The job fails on empty extraction, a repeated URL, a next action that does not navigate, or a page limit reached before the final page.
