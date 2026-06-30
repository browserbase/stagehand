---
"browse": patch
---

Nudge cloud search/fetch users toward `browse open`. After a successful `browse cloud search` or `browse cloud fetch`, the CLI prints a one-line, once-per-install tip to stderr pointing at `browse open <url>` — stdout stays machine-clean, the tip never fires on failures, and it can be disabled with `BROWSE_DISABLE_OPEN_NUDGE=1` (also skipped in CI and tests). The once-per-install marker lives in the CLI cache dir (`open-nudge.json`), mirroring the existing update-check/skill-nudge cache-file pattern.
