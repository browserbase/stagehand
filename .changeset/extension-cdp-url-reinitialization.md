---
"@browserbasehq/stagehand-extension": patch
---

Honor a changed extension CDP WebSocket URL when creating a new Stagehand instance after closing the previous one. Replace the existing browser connection when the supplied endpoint changes, and reuse it when the endpoint matches or is omitted.
