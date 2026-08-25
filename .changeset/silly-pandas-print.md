---
"@browserbasehq/stagehand-protocol": minor
"@browserbasehq/stagehand-python": patch
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand-go": patch
"@browserbasehq/stagehand": minor
---

add page.pdf() as a thin passthrough to CDP Page.printToPDF, mirroring Playwright's option surface (format, margins with px/in/cm/mm units, header/footer templates, tagged/outline, omitBackground). Headless Chrome only.
