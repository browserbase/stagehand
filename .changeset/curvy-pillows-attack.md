---
"@browserbasehq/stagehand": patch
---

Fix `agent.execute()` occasionally reporting a completed run as failed (most often with reasoning models such as `openai/gpt-5.x`).
