---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
"@browserbasehq/stagehand-go": patch
---

Fold the internals of Chrome's user-agent shadow roots, such as a date field's segments or a text field's inner editor, into their host's line in the snapshot outline, and show date and time inputs' value format, e.g. `[format: YYYY-MM-DD]`.
