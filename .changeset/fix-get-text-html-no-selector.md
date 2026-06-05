---
"@browserbasehq/browse-cli": patch
---

Fix `browse get text` and `browse get html` crashing with `Cannot read properties of null (reading 'startsWith')` when called without a selector. Both commands now default to `body` (matching `browse get markdown`) and return whole-page content.
