---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
"@browserbasehq/stagehand-go": patch
---

Speed up `text=` locator `count()` and `nth()` on large repeated lists by matching text in a single linear pass and resolving only the requested index.
