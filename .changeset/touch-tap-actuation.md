---
"@browserbasehq/stagehand": patch
---

Actuate agent clicks as touch on mobile sessions, in both `cua` and `hybrid` mode.
Touch-gated mobile layouts ignore synthesized mouse clicks, so a size selector would
highlight but still report "please choose a size". Coordinate clicks (and the
click-to-focus before typing or filling a form) now dispatch a trusted
`Input.dispatchTouchEvent` tap. Add a `useTouch` option to control this explicitly;
when omitted it is derived from the session (Browserbase `browserSettings.os` of
`"mobile"`/`"tablet"`, or a local session's `hasTouch`).
