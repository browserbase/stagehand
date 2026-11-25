---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

Fix `waitForLoadState("networkidle")` timing out on an already-idle page, and make `networkidle` waits count requests already in flight.
