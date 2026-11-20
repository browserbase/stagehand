---
"@browserbasehq/stagehand-protocol": major
"@browserbasehq/stagehand-extension": minor
"@browserbasehq/stagehand": minor
"@browserbasehq/stagehand-python": minor
---

Add `locator.locator()` in TypeScript and Python to search within a locator's matches, entering iframe documents when a match is an iframe, such as `page.locator({ type: "css", value: ".card" }).nth(1).locator({ type: "text", value: "Pay" })`.
