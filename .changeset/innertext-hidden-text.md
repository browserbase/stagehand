---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

Return an empty string from `locator.innerText()` when all of an element's text is hidden, instead of falling back to its `textContent`.
