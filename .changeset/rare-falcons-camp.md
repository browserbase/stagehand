---
"@browserbasehq/browse-cli": patch
---

Use the exact DevToolsActivePort websocket path for local auto-connect and bare-port CDP attach to avoid extra remote debugging probes before the real browser connection.
