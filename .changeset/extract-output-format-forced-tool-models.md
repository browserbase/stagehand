---
"@browserbasehq/stagehand": patch
---

Use native structured output for `extract` with Claude Sonnet 5.5, Opus 5.5, Fable 5, and Fable 5.1, which reject the forced tool call that the `jsonTool` fallback sends.
