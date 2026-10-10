---
"browse": minor
---

Add opt-in `--list-version 2` to resource and catalog lists, with a shared total `--limit`, `--all`, table/JSON formatting, and `{ data, hasMore, nextCursor }` JSON output. Secrets lists can follow cursors automatically without skipping records. Existing commands retain their default output and pagination behavior.
