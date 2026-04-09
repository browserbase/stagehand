---
"@browserbasehq/stagehand": patch
---

Add variable substitution to the keys tool in both live execution and cache replay paths. When keys steps with `method="type"` contain `%variableName%` tokens, they are now resolved against the provided variables. This brings the keys tool to parity with the type tool's variable handling.
