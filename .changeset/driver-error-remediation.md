---
"browse": patch
---

Make driver (browser session) failures actionable, classified, and self-correcting.

- An invalid `BROWSERBASE_API_KEY` no longer surfaces a bare `401 Unauthorized`: remote init failures are classified (401 invalid key, 403 permissions/plan, other) into actionable messages that point at the key settings page, `--local`, and `browse doctor`.
- A missing local Chrome now explains how to install Chrome, attach with `--cdp`, or switch to remote, instead of leaking chrome-launcher internals.
- Cached init failures back off exponentially (5s doubling, capped at 5 minutes) and append a "failing repeatedly" hint after 3 consecutive failures, so retry-looping agents get a clear self-correction signal instead of instant identical errors forever.
- The daemon protocol now carries optional `code`/`httpStatus` on error responses (backward compatible), and the client records them as telemetry result codes — `open` failures stop being 94% `unexpected`. New codes include `remote_auth_401`, `remote_auth_403`, `remote_session_create_failed`, `no_chrome_found`, `stale_ref`, `no_active_page`, `daemon_lock_timeout`, `daemon_unresponsive`, `daemon_socket_timeout`, and `daemon_spawn_failed`.
