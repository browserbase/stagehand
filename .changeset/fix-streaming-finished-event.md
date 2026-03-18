---
"@browserbasehq/stagehand": patch
---

Fix streaming finished event being silently dropped. The final SSE event containing the result payload (success status, message, actions, usage, and messages) was previously discarded instead of being yielded to the caller.
