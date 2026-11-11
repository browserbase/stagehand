# Research with the AI SDK

Read two approved Stagehand docs pages and save a comparison of `act()` and `extract()` to `out/report.json`.

Follow the [repository setup](../README.md#run), then run these commands from the repository root:

```bash
pnpm install --frozen-lockfile
cp packages/examples/cookbooks/ai-sdk-research-agent/typescript/.env.example packages/examples/cookbooks/ai-sdk-research-agent/typescript/.env
```

Add `BROWSERBASE_API_KEY` and `OPENAI_API_KEY` to `.env`, then run `just cookbook ai-sdk-research-agent` from the repository root.

Edit `sourceUrls` in `src/index.ts` and set `RESEARCH_QUESTION` to change the task. Update the report schema and source checks if changing the number of sources. Page reads are serialized; redirects and unapproved URLs are rejected. Every requested source must be read and cited. Citation checks do not establish factual accuracy.

Generation is limited to 10 steps, 120 seconds, and 3,000 output tokens, with no model retries. Browser lifetime is five minutes. Run `pnpm exec turbo run typecheck --filter=stagehand-cookbook-ai-sdk-research-agent` from the repository root.
