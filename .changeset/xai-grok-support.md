---
"@browserbasehq/stagehand-protocol": minor
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand-python": minor
"@browserbasehq/stagehand-go": minor
"@browserbasehq/stagehand": minor
---

Add direct xAI Grok support with a provider API key. Model Gateway does not support xAI, and direct xAI Responses requests reject stop sequences. `ModelProvider` gains `xai`; consumers with exhaustive TypeScript checks may need to update them.
