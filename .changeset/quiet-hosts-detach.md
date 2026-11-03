---
"@browserbasehq/stagehand": minor
"@browserbasehq/stagehand-python": minor
---

add `browser.disconnect()`, which closes an attached Stagehand instance and the connection to a browser without closing the browser or releasing its Browserbase session (Browserbase still ends sessions without `keepAlive` on disconnect). `browser.close()` after `disconnect()` now throws (connect again to close the browser), a launched local browser receives `Browser.close` before it is terminated, browser handles expose `cdpUrl` (`cdp_url` in Python) for local browsers, and `connected` reports whether the handle still has a live connection
