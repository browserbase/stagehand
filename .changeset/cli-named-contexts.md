---
"browse": patch
---

Add named contexts to the CLI so you can reuse a Browserbase context by a memorable name instead of its ID. `browse cloud contexts create --name <name>` saves a local name→ID alias (stored at `(XDG_CONFIG_HOME||~/.config)/browserbase/contexts.json`, honoring `BROWSERBASE_CONFIG_DIR`), `browse cloud contexts list` shows your saved names, and any place that accepts a context ID — `contexts get|update|delete` and `sessions create --context-id` — now also accepts a saved name. Deleting a context prunes its local alias, and a typo'd name fails with a "did you mean?" hint instead of a cryptic API error. The map is purely client-side: it stores the same IDs the API already returns, and a missing or corrupt file degrades to "no saved contexts" rather than erroring.
