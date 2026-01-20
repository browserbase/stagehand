---
"@browserbasehq/stagehand": major
---

Enabled API-side action caching. After an action has been repeated at a certain threshold server-side, its inference will be cached. This allows you to make repeated act, extract, and observe calls at no added cost. This is opt-in by default but may be disabled by toggling `disableCaching` in either the Stagehand constructor or in an individual action's options interface.
