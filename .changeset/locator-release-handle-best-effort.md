---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-go": patch
"@browserbasehq/stagehand-python": patch
---

Stop locator `selectOption()`, `type()` and the read helpers from failing after they succeed when the page navigates before the element handle is released
