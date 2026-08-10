---
"@browserbasehq/stagehand": minor
---

Expose `sessionId` on `StagehandBrowser` handles for Browserbase-backed browsers (`browserbase.launch` and `browserbase.connect`). Undefined for local browsers. This removes the need for out-of-band session-id recovery (metadata markers, session listing) when persisting sessions for reconnect.
