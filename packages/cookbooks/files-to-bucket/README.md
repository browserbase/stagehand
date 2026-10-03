# Save extracted files to a bucket

Stagehand extracts book data from Books to Scrape in a Browserbase cloud browser. The script downloads a cover and writes `out/catalog.json` and `out/cover.jpg`. When `S3_BUCKET` is set, Files SDK uploads both objects through its S3 adapter.

Add `BROWSERBASE_API_KEY` and `OPENAI_API_KEY` to `typescript/.env`. The cover URL comes from the image DOM. Bucket credentials are read by Files SDK from the AWS credential chain and never enter the browser. `S3_BUCKET` is optional so the local output can be checked first.

```bash
cd typescript
cp .env.example .env
pnpm install --frozen-lockfile
pnpm start
```

Files SDK currently provides a TypeScript package; this cookbook has no Python or Go version. See the matching [docs page](https://docs.stagehand.dev/v4/cookbooks/files-to-bucket).

Downloads allow only HTTPS on `books.toscrape.com`, reject redirects, verify JPEG bytes, and stop after 15 seconds or 5 MiB. Change the allowlist explicitly when adapting the target. Browser lifetime is five minutes. Uploads overwrite the configured keys; use a distinct `S3_PREFIX` for separate snapshots. Run `pnpm test` without credentials to check download limits.
