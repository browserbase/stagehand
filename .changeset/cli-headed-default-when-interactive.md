---
"browse": patch
---

Local managed sessions now default to headed when run interactively with a display; headless for agents/CI/no-display/non-TTY. Pass `--headed`/`--headless` to override.

Telemetry now records the resolved `session_mode` and `headless` choice on `cli.command_completed`, so headed-vs-headless usage is observable.
