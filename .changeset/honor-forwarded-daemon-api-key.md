---
"browse": patch
---

Honor `BROWSERBASE_API_KEY` passed to an already-running driver daemon. Previously, if the first remote command started the daemon without a key, a later `BROWSERBASE_API_KEY=… browse open <url> --remote` (or an exported key in a new shell) kept failing with "Missing BROWSERBASE_API_KEY" because the detached daemon captured `process.env` once at spawn time and never saw the new key. The client now forwards the caller's key over the (localhost, owner-only) driver socket with every command, and the daemon threads it straight into the Stagehand constructor when it creates the session — so an inline or exported key works without a manual `browse stop` and restart. The forwarded key is never written back into the daemon's `process.env`; its only home is the live session. Already-initialized warm sessions are untouched; the forwarded key only takes effect at session init. The local-only (CDP-only) build forwards nothing and remains free of any API-key code path.
