---
"@browserbasehq/browse-cli": patch
---

Fix `browse env remote --connect <session-id>` silently ignoring `--connect`. The env handler now writes the connect file when the flag is set (and removes it when switching to local mode), and restarts the daemon when the connect ID changes. Without this, the daemon would create a fresh companion session instead of resuming the requested one.
