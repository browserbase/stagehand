---
"browse": patch
---

Emit a `skill_id` property on `cli.command_completed` telemetry.

The validated, catalog-public skill id (e.g. `yelp.com/extract-reviews`, or `bundled/browse` for `skills install`) is attached to the completion event for `browse skills add`/`install`, covering both successful installs and every downstream failure path (`skill_not_found`, `skill_install_failed`, ...). Only the parsed, regex-validated id is ever attached — never the raw argument.
