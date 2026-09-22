---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand-go": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

`act()` can resolve common instructions (click, type, select, scroll, press) in a few hundred milliseconds through TypeSafe Jev instead of a full LLM call, behind the new experimental, off-by-default `experimentalJevAct` init param (TypeScript SDK: `STAGEHAND_EXPERIMENTAL_JEV_ACT`). When Jev is not confident the existing LLM path runs unchanged.
