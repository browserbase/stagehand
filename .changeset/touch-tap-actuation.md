---
"@browserbasehq/stagehand": minor
---

Actuate the computer-use agent's clicks as touch on mobile sessions. Added a coordinate `page.tap(x, y)` (trusted `Input.dispatchTouchEvent`, mirroring `page.click`), and the CUA agent now routes `click` → `page.tap` when the session presents as mobile (`navigator.userAgentData.mobile`, detected once per run). Mobile layouts that gate size selectors / add-to-cart on touch events — where a synthesized mouse click registers as "no selection" — now respond correctly.
