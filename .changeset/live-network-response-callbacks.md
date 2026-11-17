---
"@browserbasehq/stagehand": minor
"@browserbasehq/stagehand-python": minor
"@browserbasehq/stagehand-extension": minor
"@browserbasehq/stagehand-protocol": minor
---

Add `page.onResponse()` in TypeScript and `page.on_response()` in Python to observe network responses from a page and its child frames. Callbacks receive SDK Response objects when headers arrive, with lazy body retrieval and subscription handles for stopping callbacks.
