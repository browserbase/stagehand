---
"browse": patch
---

feat(cli): surface the navigation httpStatus on `browse open` (and reload/back/forward) so agents can tell a real 200 page apart from a loaded 4xx/5xx error page. Adds an optional `httpStatus` field; a normal 200 page is unchanged.
