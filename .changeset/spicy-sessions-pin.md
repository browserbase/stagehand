---
"@browserbasehq/stagehand-server-v3": patch
---

Prevent long-running agent runs from having their sessions ended early.

The hosted API's session store could LRU-evict or TTL-expire a session while a request was still using it, surfacing as a "Stagehand session was closed" error on an action that had already succeeded. Sessions are now pinned for the full duration of a request (via a `withSession` wrapper and an `inUse` refcount) and excluded from eviction/expiry while in use. The pin is taken before lazy `init()`, released only after the handler settles, and unmatched releases are ignored.
