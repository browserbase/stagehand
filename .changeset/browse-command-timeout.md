---
"browse": patch
---

Honor a command's own `--timeout` in the daemon transport. `browse wait`, `reload`, `back`, and `forward` were capped at the fixed 35s transport budget, so any `--timeout` above that aborted the client while the daemon was still working — including the documented `browse wait load networkidle --timeout 45000`.
