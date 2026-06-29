---
"browse": patch
---

Add `--verified` and `--proxies` to remote driver sessions so `browse open <url> --remote --verified --proxies` opens a Verified and/or proxied Browserbase session in one command — no more create-then-attach with `--cdp`.

- The flags are valid only with `--remote` (they are never implied, since that would silently switch to billed cloud sessions) and are sticky for the session's lifetime like `--headed`/`--headless`: a re-open requesting different settings fails with the usual stop-and-reopen error.
- Because the session is created through the normal remote path (not a raw `--cdp` attach), it keeps its Browserbase identity and the `browse_cli` attribution tag. `browse status` and `browse doctor` now surface the Browserbase session ID, the dashboard URL, the live-view (debug) URL, and the verified/proxies state.
- `--verified` requires a Browserbase Scale plan.
