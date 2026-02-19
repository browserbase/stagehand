---
"@browserbasehq/stagehand": patch
---

**Server-side caching is now available.** 

When running `env: "BROWSERBASE"`, Stagehand automatically caches `act()`, `extract()`, and `observe()` results server-side — repeated calls with the same inputs return instantly without consuming LLM tokens.

Caching is enabled by default and can be disabled via `serverCache: false` on the Stagehand instance or per individual call. Check out the [browserbase blog](https://www.browserbase.com/blog) for more details.
