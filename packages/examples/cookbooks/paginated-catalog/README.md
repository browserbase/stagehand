# Export a paginated catalog

Extract book records, save each page to `out/checkpoint.json`, and write `out/catalog.json` when pagination ends. TypeScript and Python share the checkpoint format.

Copy `.env.example` to `.env` in a language folder and add `BROWSERBASE_API_KEY` and `OPENAI_API_KEY`.

Follow the [repository setup](../README.md#run), then run these commands from the repository root:

```bash
pnpm install --frozen-lockfile
cp packages/examples/cookbooks/paginated-catalog/typescript/.env.example packages/examples/cookbooks/paginated-catalog/typescript/.env
```

Fill in the TypeScript `.env`, then run `just cookbook paginated-catalog` from the repository root. It builds the local SDK and extension before starting the recipe.

For Python, follow the [Python setup](../README.md#python) and run `just install` from the repository root. Copy this cookbook's `python/.env.example` to `python/.env`, fill in its keys, then run `just cookbook-python paginated-catalog` from the root. It builds the extension and runs the cookbook with the local Python SDK; `.env` and `out/` stay in the cookbook's `python/` directory.

The default target is a two-page category. `MAX_PAGES` defaults to 2 and allows up to 100. Adapt `CATALOG_URL`, the record schema, and `NEXT_SELECTOR` together. Browser lifetime is five minutes.

Rerun with the same source and `OUT_DIR` to resume. A failed run keeps its checkpoint; reaching the page limit does not publish a complete catalog. Use a fresh output directory for a new snapshot or schema. Run one writer per directory.

Records are deduplicated by title, price, and availability. Use stable product IDs for catalogs where those fields are not unique. Saved pages retain their earlier values.

Run `pnpm exec turbo run typecheck test:unit --filter=stagehand-cookbook-paginated-catalog` from the repository root, or `uv run --locked python -m unittest` in `python/`.
