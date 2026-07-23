---
"@browserbasehq/stagehand": patch
---

Actuate the CUA clicks as touch on mobile sessions. Add a `useTouch` option to
control this explicitly; when omitted it is derived from the session (Browserbase
`browserSettings.os` of `"mobile"`/`"tablet"`, or a local session's `hasTouch`).
