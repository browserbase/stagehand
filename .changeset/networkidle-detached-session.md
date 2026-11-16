---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
---

Fix `networkidle` waiting until its timeout when an out-of-process iframe detaches while one of its requests is still in flight.
