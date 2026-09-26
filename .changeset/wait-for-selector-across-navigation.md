---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
---

`page.waitForSelector()` survives the navigation it is waiting through: when the commit rejects the pending evaluate with "Inspected target navigated or closed" (or "Execution context was destroyed"), the wait is re-issued against the new document with the remaining timeout instead of failing.
