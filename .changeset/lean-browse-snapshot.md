---
"browse": patch
---

`browse snapshot` is now lean by default: it prints the formatted accessibility tree only, omitting the `xpathMap`/`urlMap` ref maps (~217KB / ~60K tokens on a content-heavy page) that were previously included on every snapshot.

Ref-based element commands (`click`, `fill`, `select`, etc.) are unaffected — the ref maps are still captured and cached server-side, so refs resolve exactly as before. To get the maps in the output, pass the new `--full` flag. The `--compact` flag is now a deprecated no-op alias of the default (it prints a stderr-only, TTY-gated deprecation notice).
