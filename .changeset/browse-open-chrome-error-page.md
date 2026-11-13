---
"browse": patch
---

Make `browse open`, `reload`, `back`, and `forward` fail with a `navigation_failed` error when the page ends on Chrome's network error page, instead of reporting the error page as a successful navigation.
