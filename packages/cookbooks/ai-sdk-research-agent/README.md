# Research with the AI SDK

Read two approved Stagehand docs pages and save a comparison of `act()` and `extract()` to `out/report.json`.

```bash
cd typescript
cp .env.example .env
pnpm install --frozen-lockfile
```

Add `BROWSERBASE_API_KEY` and `OPENAI_API_KEY` to `.env`, then run `pnpm start`.

Edit `sourceUrls` in `src/index.ts` and set `RESEARCH_QUESTION` to change the task. Update the report schema and source checks if changing the number of sources. Page reads are serialized; redirects and unapproved URLs are rejected. Every requested source must be read and cited. Citation checks do not establish factual accuracy.

Generation is limited to 10 steps, 120 seconds, and 3,000 output tokens, with no model retries. Browser lifetime is five minutes. Run `pnpm typecheck` locally.
