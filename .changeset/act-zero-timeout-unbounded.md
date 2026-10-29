---
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-go": patch
"@browserbasehq/stagehand-python": patch
---

Stop the SDK from cutting off `act()`, `extract()` and `observe()` after 10 seconds when `timeout` is `0`, which the extension treats as no timeout
