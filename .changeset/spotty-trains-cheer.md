---
"@browserbasehq/stagehand": patch
---

Fix `page.screenshot({ clip })` returning a blank image for regions outside the current viewport. CDP `Page.captureScreenshot` only renders the visible viewport unless `captureBeyondViewport` is set, and Stagehand enabled it only for `fullPage` — so a `clip` below the fold (or an element scrolled off-screen) came back blank. `captureBeyondViewport` is now auto-enabled whenever a clip falls outside the current viewport (matching Playwright), while in-viewport clips are unchanged. (STG-2335)
