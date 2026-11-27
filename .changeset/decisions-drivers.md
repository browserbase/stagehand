---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
---

`experimentalDecisions.extract()` with `screenshot: true` and `llmFallback: false` now fails instead of using the language model, except with `extract: "judge"`; `act()`, `observe()` and `extract()` are otherwise unchanged.
