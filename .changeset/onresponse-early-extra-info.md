---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

Fix `page.onResponse()` responses missing headers such as `set-cookie` when Chrome sends their extra info before the response itself.
