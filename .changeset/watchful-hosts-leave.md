---
"@browserbasehq/stagehand": minor
"@browserbasehq/stagehand-python": minor
"@browserbasehq/stagehand-extension": minor
---

the extension now notices when the SDK process disappears without `disconnect()` or `close()` (a crash, `SIGKILL`, or a dropped connection): it shuts down a local browser Stagehand launched without `keepAlive`, and otherwise releases the Stagehand instance and its own connection so the browser can be attached again. With an older extension or a Chrome without hidden targets, the SDK warns once and continues without it
