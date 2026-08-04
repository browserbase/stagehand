---
"@browserbasehq/stagehand": minor
"@browserbasehq/stagehand-python": minor
"@browserbasehq/stagehand-go": minor
"@browserbasehq/stagehand-server": minor
---

Surface cache observability on act/observe/extract results. `metadata.cacheStatus` is replaced by `metadata.cache`, which always reports a `status` (`HIT`, `MISS`, or `DISABLED` when no lookup ran) alongside `count`, `threshold`, `missReason`, and `tokensSaved`.
