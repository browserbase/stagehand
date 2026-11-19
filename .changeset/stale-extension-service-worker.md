---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

Replace a Stagehand extension service worker that a browser profile kept from a different build. The extension now exposes its build identity, and when the SDK loaded the extension, or finds it installed from the SDK's own extension directory, and the worker runs another build, it reloads the extension; for an extension it does not own, it logs a warning and continues.
