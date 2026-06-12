---
"browse": patch
---

Emit `skill_id` and `first_success` properties on `cli.command_completed` telemetry.

- `skill_id`: the validated, catalog-public skill id (e.g. `yelp.com/extract-reviews`, or `bundled/browse` for `skills install`) is attached to the completion event for `browse skills add`/`install`, covering both successful installs and every downstream failure path (`skill_not_found`, `skill_install_failed`, ...). Only the parsed, regex-validated id is ever attached — never the raw argument.
- `first_success: true` is emitted exactly once per anonymous install: the first time a browser-driver command completes successfully, tracked via a marker file stored alongside the existing anonymous install id. Best-effort like all CLI telemetry — it never affects command behavior.
