---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
---

Fix XPath selectors with a `/` inside a predicate or string, such as `//button[text()="Sign in / Register"]`, being rewritten before they reach the page.
