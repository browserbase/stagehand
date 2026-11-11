---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

Fix network-idle waits to include pending requests and resolve on already-idle pages. Navigation and load-state waits now share the same main-document checks, follow replacement documents, require the full 500 ms quiet period, and stop when the timeout expires or the page closes. Worker traffic without a document loader and requests from replaced documents no longer keep the wait pending.

Load-state timeouts now include readiness checks. A zero timeout rejects immediately, including when the page is already loaded.
