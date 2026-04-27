---
"@browserbasehq/browse-cli": patch
---

`browse cdp` now also calls `Page.setLifecycleEventsEnabled` whenever the Page domain is enabled, so consumers receive `Page.lifecycleEvent` notifications (`init`, `commit`, `DOMContentLoaded`, `load`, `firstPaint`, `firstContentfulPaint`, `networkAlmostIdle`, `networkIdle`, etc.) in addition to `Page.frameNavigated`. `--pretty` mode formats lifecycle events with the milestone name. No effect on consumers that pass `--domain` without `Page`.
