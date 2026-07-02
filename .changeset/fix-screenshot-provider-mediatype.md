---
"@browserbasehq/stagehand": patch
---

Declare the CUA screenshot media type at the capture boundary instead of hardcoding `image/png` in each computer-use client. `setScreenshotProvider` now returns `{ base64, mediaType }` (`ScreenshotProviderResult`) rather than a bare base64 string, and the Anthropic, Google, OpenAI, and Microsoft clients pass the media type through to their function-response payloads. This fixes non-PNG screenshots being mislabeled as PNG (closes #2046) and removes the per-client PNG-only data-URL parsing.
