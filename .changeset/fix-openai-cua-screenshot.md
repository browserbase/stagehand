---
"@browserbasehq/stagehand": patch
---

Fix OpenAI CUA `computer-use-preview` requests failing with 400 errors by including an initial screenshot in the first API request and using `input_image` format for error fallback payloads.
