---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand-go": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

Two more opt-ins under the experimental `experimentalJevAct` init param, both off by default: `observe: true` resolves `observe()` through TypeSafe Jev before the LLM, and `cacheCheck: true` verifies each cached action still points at a matching element before replaying it (stale entries are re-inferred instead of clicked).
