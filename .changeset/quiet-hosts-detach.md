---
"@browserbasehq/stagehand": minor
"@browserbasehq/stagehand-python": minor
---

add `browser.disconnect()`, which closes an attached Stagehand instance and the connection to a browser without closing the browser or releasing its Browserbase session (Browserbase still ends sessions without `keepAlive` on disconnect)
