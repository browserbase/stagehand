---
"browse": patch
---

Surface the browse skill at runtime with two static touchpoints. Root help (`browse` / `browse --help`) now always leads with a "Start here (for AI agents)" banner pointing to `browse skills install`. Separately, the first regular command on a fresh install prints a one-time stderr hint (never stdout) when the canonical skill dir (`~/.agents/skills/browse`) is absent — gated by a once-per-install marker file in the CLI cache dir, skipped on `help`/`skills` commands and in CI/tests, and disabled with `BROWSE_DISABLE_SKILL_NUDGE=1`. No agent detection, session keys, or time windows are involved; the only check is one canonical-path lookup. Command telemetry includes a `skill_present` property driven by the same check so skill adoption is measurable.

Also stop the "Update available" notice from printing on every command. The update check still refreshes its cache silently in the background, but the notice is now shown only on the human-facing surfaces — `browse` / `browse --help` and `browse doctor` — so it no longer spams scripts and agent command loops.
