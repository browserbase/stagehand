---
"@browserbasehq/stagehand": minor
---

Actuate the computer-use agent's clicks as touch on mobile sessions. Added a coordinate `page.tap(x, y)` and a deterministic `locator.tap()` (trusted `Input.dispatchTouchEvent`, mirroring click), registered `tap` in the act method map so recorded/replayed steps reproduce it. The CUA agent now routes a single left `click` → tap when the session presents as mobile (`navigator.userAgentData.mobile`, detected once per run); right/middle/multi-clicks keep the mouse path. Mobile layouts that gate size selectors / add-to-cart on touch events — where a synthesized mouse click registers as "no selection" — now respond correctly.
