---
"@browserbasehq/stagehand": patch
---

`browserbase.launch` accepts `extensionCdpUrl`, the browser-level CDP WebSocket URL the in-browser worker dials, instead of forwarding it to session creation. It behaves like the existing `localBrowser.connect` option.
