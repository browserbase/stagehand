---
"@browserbasehq/stagehand": patch
---

fix issue where scripts added via context.addInitScripts() were not being injected into new pages that were opened via popups (eg, clicking a link that opens a new page) and/or calling context.newPage(url)
