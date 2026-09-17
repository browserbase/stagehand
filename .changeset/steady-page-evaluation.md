---
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
"@browserbasehq/stagehand-go": patch
"@browserbasehq/stagehand-extension": patch
---

Keep page evaluation results alive while Chrome awaits and serializes them, preventing intermittent `Promise was collected` failures during page churn.
