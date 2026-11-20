---
"@browserbasehq/stagehand": patch
---

fix http status codes being lost during browserbase session creation, so downstream consumers can distinguish auth/payment/rate-limit failures
