---
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-server": patch
---

Replace hardcoded provider enum with z.string() in model configuration schemas. The provider field is optional, not validated server-side, and was out of sync with the actual supported providers. New providers no longer require schema updates.
