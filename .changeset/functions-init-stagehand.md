---
"browse": patch
---

`functions init` now scaffolds a Stagehand project. It installs `@browserbasehq/stagehand` instead of `playwright-core`, installs the zod version that Stagehand uses, and writes a Stagehand starter function, a `stagehand.ts` helper that reads API keys from Function secrets, and `OPENAI_API_KEY` in `.env`.
