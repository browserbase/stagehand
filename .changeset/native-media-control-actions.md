---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
"@browserbasehq/stagehand-go": patch
---

Click, double-click and hover native media controls (play, mute, full screen, time and volume sliders) at their own position instead of the middle of the `<video>` or `<audio>` element. These actions are not cached, and `observe()` leaves the controls out, since their selector is the media element's.
