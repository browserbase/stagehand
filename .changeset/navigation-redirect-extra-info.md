---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

Fix navigation responses after a redirect sometimes reporting the redirect's headers, such as its `set-cookie` and `location`, instead of their own.
