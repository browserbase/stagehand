# Research two Stagehand docs with the AI SDK

A research agent compares `act()` and `extract()` using two approved Stagehand documentation pages. It keeps one Browserbase browser alive across tool calls and prints a typed JSON report with the exact source URLs used.

```bash
cd typescript
cp .env.example .env
pnpm install --frozen-lockfile
pnpm start
```

Add `BROWSERBASE_API_KEY` and `OPENAI_API_KEY` to `.env`. Both Stagehand and the agent use OpenAI. The source-reading tool serializes navigation and extraction on the shared page. An unapproved URL fails before navigation. The report fails if either page was not visited and extracted or if it cites another URL.

Edit the `sourceUrls` array in `src/index.ts` and set `RESEARCH_QUESTION` to change the task. Redirects are rejected. The report is saved to `out/report.json`. Generation has a 10-step, 120-second, 3,000-output-token limit, with no model retries. Browser lifetime is five minutes. Citation checks do not prove that every generated fact is correct.
