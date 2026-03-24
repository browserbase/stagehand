---
"@browserbasehq/browse-cli": patch
---

Allow `--ws` to accept a bare port number (e.g. `--ws 9222`) in addition to full WebSocket URLs. When a port is given, the CLI resolves the CDP WebSocket URL via `/json/version`.
