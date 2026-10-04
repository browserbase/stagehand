---
"@browserbasehq/stagehand-python": patch
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand-protocol": patch
"@browserbasehq/stagehand-go": patch
"@browserbasehq/stagehand": patch
---

add per-call locator timeouts across TypeScript, Python, & Go. one timeout covers frame readiness, element lookup, & execution, including typing delays & highlight duration. the default is 20 seconds. setting timeout to 0 disables it.
