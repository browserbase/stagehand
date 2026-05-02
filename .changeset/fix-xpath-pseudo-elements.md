---
"@browserbasehq/stagehand": patch
---

fix: skip CSS pseudo-elements when generating XPath segments. Chromium leaks `::before`/`::after` nodes into `Protocol.DOM.Node.children`; they produced unresolvable selectors like `*[name()='::after'][1]` that deterministically broke cached replays.
