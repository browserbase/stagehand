---
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
"@browserbasehq/stagehand-extension": patch
---

Drop stale nested-frame ownership when a frame detaches or its page closes, so a reused browser context does not retain closed pages.
