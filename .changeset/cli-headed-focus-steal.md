---
"browse": patch
---

Stop headed local sessions from stealing OS focus on every command.

In headed managed-local mode the browse daemon re-resolved the active page on every subcommand and called `setActivePage()` unconditionally, which ends in a CDP `Target.activateTarget`. On macOS that raises the whole Chrome app to the OS foreground, stealing keyboard focus from the editor/terminal on each `browse navigate/snapshot/get/…` — making the CLI nearly unusable alongside a coding agent and impossible to parallelize. The active tab is now re-activated only when it actually changes; explicit `tab new` / `tab select` still foreground intentionally.
