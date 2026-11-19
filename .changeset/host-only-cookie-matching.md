---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

pr: #3465
commit: 9d3cfa51589ab1fdc85e16ddfc09f8c44dc7e2b9
author: @Kelvin-Waititu

Respect host-only cookie domains when filtering context cookies by URL, while continuing to match subdomains for cookies with a leading-dot domain.
