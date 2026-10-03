# Export a paginated catalog

Extract book records, save each page to `out/checkpoint.json`, and write `out/catalog.json` when pagination ends. TypeScript, Python, and Go share the checkpoint format.

Copy `.env.example` to `.env` in a language folder and add `BROWSERBASE_API_KEY` and `OPENAI_API_KEY`.

- TypeScript: `pnpm install --frozen-lockfile`, then `pnpm start`.
- Python: `uv sync --locked`, then `uv run --locked python main.py`.
- Go: export `.env` with `set -a; . ./.env; set +a`, then `go run .`.

The default target is a two-page category. `MAX_PAGES` defaults to 2 and allows up to 100. Adapt `CATALOG_URL`, the record schema, and `NEXT_SELECTOR` together. Browser lifetime is five minutes.

Rerun with the same source and `OUT_DIR` to resume. A failed run keeps its checkpoint; reaching the page limit does not publish a complete catalog. Use a fresh output directory for a new snapshot or schema. Run one writer per directory.

Records are deduplicated by title, price, and availability. Use stable product IDs for catalogs where those fields are not unique. Saved pages retain their earlier values.

Run `pnpm typecheck` and `pnpm test`, `uv run --locked python -m unittest`, or `go test ./...` in the matching folder.
