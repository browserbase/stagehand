---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
---

`page.waitForSelector()` survives the navigation it is waiting through: when the commit rejects the pending wait with "Inspected target navigated or closed" or "Execution context was destroyed", the wait is re-issued in the new document with the remaining timeout, as it already was for "Cannot find context with specified id".
