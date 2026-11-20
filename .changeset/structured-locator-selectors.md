---
"@browserbasehq/stagehand-protocol": major
"@browserbasehq/stagehand-extension": minor
"@browserbasehq/stagehand": minor
"@browserbasehq/stagehand-python": minor
---

`page.locator()` in TypeScript and Python now accepts a structured selector, such as `{ type: "xpath", value: "/html/body/div/button" }`, with `css`, `xpath`, `text`, and `legacy` types.
