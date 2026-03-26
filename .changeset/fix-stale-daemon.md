---
"@browserbasehq/browse-cli": patch
---

fix: clear cached browser state when CDP connection dies, preventing "awaitActivePage: no page available" errors when daemon outlives its browser
