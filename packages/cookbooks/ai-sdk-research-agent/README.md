# Research two Stagehand docs with the AI SDK

A research agent compares `act()` and `extract()` using two approved Stagehand documentation pages. It keeps one Browserbase browser alive across tool calls and prints a typed JSON report with the exact source URLs used.

```bash
cd typescript
cp .env.example .env
pnpm install
pnpm start
```

Add `BROWSERBASE_API_KEY` and `OPENAI_API_KEY` to `.env`. This folder uses OpenAI for the AI SDK agent and Stagehand. `OPENAI_MODEL` controls the agent model. An unapproved URL fails before navigation. The report fails if either page was not visited and extracted or if it cites another URL.
