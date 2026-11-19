---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

Make `waitForLoadState("networkidle")` (`wait_for_load_state` in Python) use the same network-idle check as `goto`, so it resolves on an already-idle page instead of timing out. Make `waitUntil: "networkidle"` wait for requests that were already in flight when the idle wait began instead of resolving 500 ms after the load event. Network-idle waits now ignore Web Worker scripts and requests from a document that navigated away.
