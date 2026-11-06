---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

Decision models are now used through an explicit namespace: `stagehand.experimentalDecisions.act()`, `.observe()` and `.extract()` (`stagehand.experimental_decisions` in Python). The `experimentalDecisions` config is a public create option in the TypeScript and Python SDKs; `stagehand.act()`, `observe()` and `extract()` never use the decision model, and the `STAGEHAND_EXPERIMENTAL_DECISIONS` environment bridge is gone.
