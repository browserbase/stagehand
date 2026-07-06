---
"@browserbasehq/stagehand": patch
---

Use the screenshot provider's declared media type when sending CUA image payloads. The `setScreenshotProvider` callback now returns `ScreenshotProviderResult` (`{ base64, mediaType }`) instead of a bare base64 string.
