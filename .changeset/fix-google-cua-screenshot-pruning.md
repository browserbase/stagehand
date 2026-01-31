---
"@browserbasehq/stagehand": patch
---

Add screenshot pruning to GoogleCUAClient to prevent memory growth

The GoogleCUAClient now prunes old screenshots from conversation history, keeping only the most recent `maxImages` (default: 3) screenshots. This matches the behavior of MicrosoftCUAClient and prevents unbounded memory growth during long agent sessions, especially on image-heavy websites.

The `maxImages` option can be configured via `clientOptions.maxImages` when initializing the agent.
