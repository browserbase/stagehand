---
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-go": patch
"@browserbasehq/stagehand-python": patch
"@browserbasehq/stagehand-extension": patch
---

Skip suppressed CDP logging and unused stack capture, reuse internal domain setup, and prepare fill input with the original handle. Retry replacement input once and require successful preparation before typing.
