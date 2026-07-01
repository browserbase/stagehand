---
"@browserbasehq/stagehand-server-v3": patch
---

Fix long-running requests (e.g. `agentExecute`) sometimes failing with "Stagehand session was closed" even though the action had already completed.
