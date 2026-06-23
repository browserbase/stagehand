---
"@browserbasehq/stagehand": patch
---

Parse screenshot MIME type from data URL in `GoogleCUAClient` function responses. Previously, `inlineData.mimeType` was hardcoded to `image/png` and the data URL prefix was stripped with a PNG-only regex, which would mishandle JPEG or WebP screenshots. The MIME type is now derived from the data URL with a PNG fallback for raw base64 input.
