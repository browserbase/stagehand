---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
"@browserbasehq/stagehand-go": patch
---

Make selector waits include frame readiness in their timeout, support unlimited waits with `timeout: 0`, and clean up observers when the wait ends.
