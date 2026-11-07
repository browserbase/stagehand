---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

Reject `locator.selectOption()` when no option matches the requested values, instead of resetting the `<select>` to its first option (or clearing a multi-select) and reporting success. The current selection is left unchanged and no `input` or `change` events fire.
