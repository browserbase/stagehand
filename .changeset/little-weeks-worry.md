---
"@browserbasehq/stagehand": minor
---

Fixes:

The last big change we pushed out, introduced a small regression. As a result, the gray outline showing the elements Stagehand is looking out is missing. This commit fixes that. We now process selectorMap properly now (using the updated type Record<number, string[]

Improved the action prompt:

Improved the structure
Made it more straightforward
Improved working for completed arg and prioritized precision over recall
