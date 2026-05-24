---
"@browserbasehq/browse-cli": patch
---

Add `--chrome-arg` global flag to pass extra Chromium flags to the local browser. The flag is repeatable (e.g. `--chrome-arg=--no-focus-on-navigate --chrome-arg=--disable-backgrounding-occluded-windows`) and forwarded through daemon spawn, direct `--ws` connections, and local strategy resolution. Fixes #2148.
