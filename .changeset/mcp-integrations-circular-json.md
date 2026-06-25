---
"@browserbasehq/stagehand": patch
---

Fix `TypeError: Converting circular structure to JSON` when creating an agent with MCP `integrations` that include a `Client` instance (e.g. a local/stdio server from `connectToMCPServer`). The agent-creation log serialized the raw `integrations` array, and a live MCP `Client` is circular. It now logs a safe descriptor (URL strings kept, client instances summarized) so `agent({ integrations: [client] })` works.
