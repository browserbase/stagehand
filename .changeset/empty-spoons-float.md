---
"@browserbasehq/stagehand": minor
---

Added a `stagehand.history` array which stores an array of `act`, `extract`, `observe`, and `goto` calls made. Since this history array is stored on the `StagehandPage` level, it will capture methods even if indirectly called by an agent.
