---
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-go": patch
"@browserbasehq/stagehand-extension": patch
---

Harden how authenticated requests are issued from the browser runtime so they are not affected by later changes to the global fetch. Internal hardening only; no public API changes.
