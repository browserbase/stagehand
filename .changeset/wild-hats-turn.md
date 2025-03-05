---
"@browserbasehq/stagehand": minor
---

`act()` can now use `observe()` under the hood, resulting in significant performance improvements. To opt-in to this change, set `slowDomBasedAct: false` in `ActOptions`.
