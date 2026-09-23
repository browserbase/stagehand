---
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
"@browserbasehq/stagehand-go": patch
---

Allow Stagehand creation to override the extension's CDP endpoint when the SDK and browser require different addresses, such as across Docker port mappings. Use `browserCdpUrl` in TypeScript, `browser_cdp_url` in Python, or `BrowserCDPURL` in Go.
