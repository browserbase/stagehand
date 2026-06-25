---
"browse": patch
---

Fix `browse skills add` on Windows and bound the unbounded installer stages.

- Quote the `npx` command and arguments when spawning through cmd.exe (`shell: true` for `.cmd`/`.bat` shims), so the default `C:\Program Files\nodejs\npx.cmd` path and install paths with spaces (e.g. `C:\Users\First Last\...`) no longer split at the space and fail with "'C:\Program' is not recognized".
- Kill the `npx skills add` child after a 180s deadline (SIGTERM, then SIGKILL) and fail with a clear message and a distinct `skill_install_timeout` telemetry result code instead of hanging forever.
- Bound the catalog and skill-file fetches with a 10s abort timeout, preserving the existing catalog-unavailable fallback semantics when a fetch hangs.
