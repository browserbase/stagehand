---
"browse": patch
---

`browse snapshot` now prints the accessibility tree only by default, omitting the `xpathMap`/`urlMap` ref maps. Pass `--full` to include them. Ref-based element commands are unaffected.
