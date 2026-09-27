---
"browse": patch
---

Fix local browser discovery (`--auto-connect`, `browse doctor`) trusting a stale cached debugging port after a different Chrome process later reuses that same port.
