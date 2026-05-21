---
"@browserbasehq/stagehand": patch
---

Add per-method `serverCache` threshold configuration. The `serverCache` option on `Stagehand` and on `act()` / `extract()` / `observe()` now accepts `boolean | { threshold: number }`, letting callers tune the minimum hit count required before cached results are returned. The constructor option additionally accepts a per-method object (`{ act, extract, observe }`) for fine-grained control. Method-level options take precedence over constructor-level defaults.
