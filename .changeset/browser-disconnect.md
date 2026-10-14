---
"@browserbasehq/stagehand": minor
"@browserbasehq/stagehand-python": minor
"@browserbasehq/stagehand-go": minor
---

Add `browser.disconnect()` in TypeScript and Python and `browser.Disconnect(ctx)` in Go to close the client transport without terminating the browser or releasing its Browserbase session. Enable Browserbase keep-alive to reconnect later. Browser close continues to release the session, even with keep-alive enabled.
