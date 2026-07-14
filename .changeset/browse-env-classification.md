---
"browse": patch
---

Tag anonymous CLI telemetry with execution-environment properties (`is_container`, `is_tty`, `runtime_provider`) so events can be segmented by where the CLI runs (container / sandbox / interactive) at the source, instead of fragile behavioral fingerprinting. `runtime_provider` is derived from `std-env` plus an env-var allowlist for agent sandboxes (e2b, modal, daytona, codespaces, gitpod, replit).
