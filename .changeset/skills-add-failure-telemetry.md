---
"browse": patch
---

Make `browse skills add` failures diagnosable and fail cleanly on unknown skills.

- Unknown (non-generated) skill ids now fail fast with an actionable "not found in the catalog" message pointing at `browse skills find`/`browse skills list`, instead of silently git-cloning the entire browse.sh repo and exiting with an opaque error.
- The `npx skills add` child's output is now buffered (tail) while still streaming live to the terminal, so a nonzero exit surfaces the real reason instead of a bare exit code.
- Failures now record distinct telemetry result codes (`skill_not_found`, `invalid_skill_id`, `npx_missing`, `skill_install_failed`) so the failure modes are measurable.
- `browse skills add` with no argument now prints actionable guidance (the `<domain>/<task>` form plus `browse skills find`) instead of oclif's bare "Missing 1 required arg".
