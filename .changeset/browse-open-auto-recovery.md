---
"browse": patch
---

Automatically recover `browse open` when its existing session has a stale browser. For non-DriverError exceptions (page.goto failures, context errors), the daemon now returns a typed `driver_error` code and the runtime force-stops the daemon before restarting.
