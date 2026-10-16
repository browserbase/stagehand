---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
---

Fix `context.clearCookies()` with a filter stripping the partition key, priority and unset SameSite from the cookies it keeps.
