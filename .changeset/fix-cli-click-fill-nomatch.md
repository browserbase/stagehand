---
"browse": patch
---

`browse click` and `browse fill` now exit non-zero and report the error when their selector matches no element, instead of printing `{ "clicked": true }` / `{ "filled": true }` and exiting 0. Both commands run through `act()`, which reports a missing element via `success:false` rather than throwing, so the failure was previously swallowed — unlike `select`/`upload`, which already error via `deepLocator`. This makes the false-positive success visible to scripts and agents.
