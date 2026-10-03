# Export a paginated book catalog

Extract validated book records, checkpoint every completed page, and write `out/catalog.json` after pagination ends. All three languages use the same checkpoint format.

Copy `.env.example` to `.env` in a language folder. Add `BROWSERBASE_API_KEY`. Browserbase Model Gateway is the default; `OPENAI_API_KEY` optionally selects direct OpenAI.

- TypeScript: `pnpm install --frozen-lockfile`, then `pnpm start`.
- Python: `uv sync --locked`, then `uv run --locked python main.py`.
- Go: export the variables in `.env`, then `go run .`.

`MAX_PAGES=2` is the default total budget, with a maximum of 100. The default target is the two-page mystery category and completes within that budget. For the full catalog, set `CATALOG_URL=https://books.toscrape.com/` and `MAX_PAGES=50`. `NEXT_SELECTOR` defaults to `li.next a`; its absence proves completion.

Rerun with the same URL and `OUT_DIR` to resume. Increase the budget if needed. Each run prints its Browserbase session link and uses a five-minute browser lifetime. Failed runs keep `out/checkpoint.json`. A completed checkpoint can recreate the final output without extraction. Use a fresh `OUT_DIR` for a new snapshot. One process per output directory.

Identical title, price, and availability tuples are deduplicated. Add product IDs before adapting this to a catalog where separate products can share those fields. A checkpoint preserves old records rather than refreshing them.

Tests need no browser credentials. Run `pnpm test`, `uv run --locked python -m unittest`, or `go test ./...`. The TypeScript tests exercise interrupted exports and resume with an in-memory browser driver.
