---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

Reuse successful DOM and Runtime setup across internal locator operations within a browser session. Failed setup remains retryable, explicit CDP enable and disable commands are still sent, and session teardown clears saved setup.
