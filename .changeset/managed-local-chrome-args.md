---
"browse": patch
---

Add Chrome launch arg flags for managed local browser sessions: `--chrome-arg <flag>` (repeatable) appends launch args on top of Chrome's defaults, `--ignore-default-chrome-arg <flag>` (repeatable) drops specific default args, and `--no-default-chrome-args` launches without any of Chrome's defaults.
