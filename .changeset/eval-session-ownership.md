---
"@browserbasehq/stagehand": patch
---

Release a newly created Browserbase session when initial attachment fails, and support explicit ownership when closing keepAlive sessions.

Retry explicitly rate-limited extension uploads without replaying ambiguous creates, and complete facade-owned browser shutdown after an explicit close.
