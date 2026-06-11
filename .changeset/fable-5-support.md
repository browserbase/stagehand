---
"@browserbasehq/stagehand": patch
---

Add claude-fable-5 support: native structured outputs via the @ai-sdk/anthropic bump, adaptive thinking (including the new "xhigh" effort) on the agent path, the API's built-in server-side refusal fallback to claude-opus-4-8, and auto tool choice for the final done call on models that reject forced tool use.
