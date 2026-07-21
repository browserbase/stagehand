---
"@browserbasehq/stagehand": patch
---

Report a dead CDP connection instead of a misleading timeout. When the browser's websocket closed mid-operation, `waitForMainLoadState` kept polling a dead session — every poll error was swallowed as "not ready yet" — and eventually failed with `waitForMainLoadState(domcontentloaded) timed out after 15000ms`, which reads like a slow page rather than a lost browser. Lifecycle waits now abort immediately with `CdpConnectionClosedError` carrying the socket close reason.
