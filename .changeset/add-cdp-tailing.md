---
"@browserbasehq/browse-cli": patch
---

Add `browse cdp <url|port>` command to attach to any CDP target and stream DevTools protocol events as NDJSON. Supports `--domain` filtering, `--pretty` mode for human-readable output, and clean piping to files or jq.
