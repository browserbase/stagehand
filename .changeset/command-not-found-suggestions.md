---
"browse": patch
---

Add did-you-mean suggestions and telemetry for unknown commands.

- Unknown commands (e.g. `browse sessions`, `browse search`, `browse auth status` — old Commander-era syntax — plus plain typos like `browse opne`) now print an actionable suggestion on stderr: an explicit alias table maps old syntax to the current command tree, with a Levenshtein nearest-match fallback for typos. The clause is omitted when there is no decent match.
- A new `cli.command_not_found` telemetry event makes this failure class measurable. Privacy: only the sanitized attempted command id and the computed suggestion are sent — never raw argv, which can contain URLs, selectors, or secrets.
- oclif's standard "command not found" error and exit code 2 are preserved; no new runtime dependency (deliberately avoids `@oclif/plugin-not-found`, which prompts interactively and is agent-hostile).
