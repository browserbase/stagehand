---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand-go": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

Resolve XPath self steps like `.//div` and `//section/./div` against the document instead of matching nothing when a shadow root routes locators through the composed-tree parser
