---
"browse": patch
---

Remove the `browse refs` command. It only re-printed the `xpathMap`/`urlMap` cached from the last `browse snapshot` — which `browse snapshot` already returns — so it was redundant, and it returned stale maps if the page had changed since that snapshot.
