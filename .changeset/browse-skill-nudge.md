---
"browse": patch
---

Surface the browse skill to coding agents. Root help (`browse` / `browse --help`) leads with an agent-targeted "Start here" banner pointing to `browse skills install` — shown only when the skill is not already installed, so it never nags users who have it. A once-per-session, agent-only nudge (stderr, never stdout) prompts detected agents that don't yet have the browse skill installed to run `browse skills install`. The nudge is throttled per agent session, skipped for humans, CI, and `skills` commands, and can be disabled with `BROWSE_DISABLE_SKILL_NUDGE=1`. Command telemetry now includes a `skill_present` property so skill adoption among agents is measurable.

Also stop the "Update available" notice from printing on every command. The update check still refreshes its cache silently in the background, but the notice is now shown only on the human-facing surfaces — `browse` / `browse --help` and `browse doctor` — so it no longer spams scripts and agent command loops.
