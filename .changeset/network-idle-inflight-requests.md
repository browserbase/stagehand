---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-go": patch
"@browserbasehq/stagehand-python": patch
---

Make `waitUntil: "networkidle"` wait for requests that were already in flight when the idle wait began instead of resolving 500 ms after the load event
