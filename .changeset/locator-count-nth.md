---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

fix `locator.count()` ignoring `nth()` and `first()`, so a narrowed locator now counts 1 when its index exists and 0 when it does not
