---
"@browserbasehq/stagehand": minor
---

Add `browser.disconnect()` to close the TypeScript client transport without terminating the browser or releasing its Browserbase session. Use a Browserbase session with `keepAlive: true` to reconnect later. `browser.close()` continues to release the session, even with keep-alive enabled.
