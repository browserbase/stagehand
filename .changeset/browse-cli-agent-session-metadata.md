---
"browse": patch
---

Stamp the detected coding agent (e.g. `claude`, `cursor`, `codex`) onto the Browserbase session `userMetadata` (`agent` key) at session create, alongside the existing `browse_cli`/`cli_version`/`install_id` attribution. This lets CLI-created cloud sessions be attributed to the coding agent that drove them. Only set when an agent is detected; caller-supplied `userMetadata` is otherwise preserved.
