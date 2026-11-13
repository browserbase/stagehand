---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

minify the bundled extension, keeping function and class names, and stop its content script from adding globals to the page a new tab opens on (a user init script declaring a name like `scope` could break `newPage()`)
