---
"@browserbasehq/stagehand": patch
---

Wire `proxy.username` / `proxy.password` through to local Chrome sessions via CDP `Fetch.authRequired` so authenticated proxies work without manual workarounds.
