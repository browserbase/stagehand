---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

Remove the extra completion-check request from ordinary LLM extraction. The completion verdict only changed log messages; extraction now uses one LLM request, and usage metadata reflects that request.
