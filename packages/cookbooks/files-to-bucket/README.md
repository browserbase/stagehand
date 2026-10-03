# Save files to a bucket

Extract books from Books to Scrape and write `out/catalog.json` and `out/cover.jpg`. Set `S3_BUCKET` to upload both through Files SDK.

```bash
cd typescript
cp .env.example .env
pnpm install --frozen-lockfile
```

Add `BROWSERBASE_API_KEY` and `OPENAI_API_KEY` to `.env`, then run `pnpm start`. Optional uploads use the AWS credential chain. Use `S3_ENDPOINT` for an S3-compatible service and a distinct `S3_PREFIX` to avoid overwriting earlier output.

The cover URL comes from the page DOM. Downloads allow HTTPS on `books.toscrape.com`, reject redirects, check JPEG bytes, and stop after 15 seconds or 5 MiB. Adapt the selector, allowlist, and format checks together for another target. Browser lifetime is five minutes.

This recipe is TypeScript-only. Run `pnpm typecheck` and `pnpm test` locally.
