---
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand-integrations-mastra-sdk": patch
---

Fix act, observe and extract with Claude Opus 5.5 by bumping `@ai-sdk/anthropic` and `ai` in the extension. Pin `@ai-sdk/anthropic` to 4.0.26 in mastra-sdk to match the `@ai-sdk/provider` version that `@mastra/core` uses.
