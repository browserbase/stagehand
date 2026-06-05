---
"@browserbasehq/browse-cli": patch
---

Fix the connect file being unlinked by every command that didn't itself pass `--connect`. After `browse env remote --connect <id>`, the next `browse open <url>` would race against the daemon's lazy initialization and delete the connect file before it could be read, causing a fresh companion session to be created instead of resuming the requested one. The connect file is now only managed when `--connect` is explicitly set on the current invocation.
