---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

Adopt cross-origin iframes that were already loaded when Stagehand attached, or that are nested inside another cross-origin iframe, so snapshots and actions can reach them.
