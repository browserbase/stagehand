---
"@browserbasehq/stagehand": patch
---

Stop injecting `--site-per-process` into local Chromium launches so user-supplied flags like `--disable-features=site-per-process` and `--renderer-process-limit` take effect.
