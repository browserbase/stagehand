---
"@browserbasehq/stagehand": minor
---

Add Valkey as an optional cache backend via iovalkey. Configure with `valkeyHost` (and optional `valkeyPort`, `valkeyTls`, `valkeyPassword`, `valkeyUsername`, `cacheTtl`, `valkeyKeyPrefix`, `valkeyRequestTimeout`, `valkeyMaxCacheValueBytes`) to store act/agent cache entries in Valkey instead of the local filesystem. Gracefully falls back to disabled caching if the connection fails.
