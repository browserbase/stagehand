---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

Make `waitForLoadState("networkidle")` (`wait_for_load_state` in Python) use the same network-idle check as `goto`, so it resolves on an already-idle page instead of timing out. Network-idle waits now ignore Web Worker scripts and requests from a document that navigated away.
