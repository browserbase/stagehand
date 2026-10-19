---
"@browserbasehq/stagehand": minor
"@browserbasehq/stagehand-protocol": minor
"@browserbasehq/stagehand-extension": minor
"@browserbasehq/stagehand-python": minor
"@browserbasehq/stagehand-go": minor
---

Add page-level function waits across TypeScript, Python, and Go. Predicates poll inside the browser's main world with animation frames or an interval, support shared deadlines and navigation recovery, and return JSON values. As in Playwright, an expression that evaluates to a function is invoked with the optional JSON argument, and TypeScript waits have no deadline unless one is passed.
