---
"@browserbasehq/stagehand-go": patch
---

Prevent queued event callbacks from being delivered after their Go SDK subscription is removed or the client shuts down, while allowing callbacks already admitted to finish.
