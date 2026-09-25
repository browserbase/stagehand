---
"@browserbasehq/stagehand": minor
"@browserbasehq/stagehand-python": minor
"@browserbasehq/stagehand-go": minor
---

Add optional console output to the TypeScript, Python, and Go SDK logging configuration, enabled by default. Set `logging.console` to `false` (a pointer to false for Go's `Logging.Console`) to suppress routine stderr output while preserving level-filtered callbacks. Existing callback-failure diagnostics still go to stderr.
