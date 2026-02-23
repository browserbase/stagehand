---
"@browserbasehq/stagehand": patch
---

fixes issue with context.addInitScript() where scripts were not being applied to out of process iframes (OOPIFs), and popup pages with same process iframes (SPIFs)
