---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
"@browserbasehq/stagehand-go": patch
---

Treat `>>` inside a quoted selector value, such as `button[aria-label="Next >>"]` or `//a[text()='Next >>']`, as part of the selector instead of an iframe hop.
