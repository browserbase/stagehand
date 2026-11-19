---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

Bound `goto`, `reload`, `goBack` and `goForward` by their `timeout` from the start, so a server that never responds fails with a navigation timeout instead of outliving it.
