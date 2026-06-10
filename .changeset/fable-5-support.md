---
"@browserbasehq/stagehand": patch
---

Bump @ai-sdk/anthropic so claude-fable-5 (and opus-4-7/4-8) work with
structured outputs: the provider's capability table now routes
structuredOutputMode "auto" to the native output_format path instead of the
forced json tool these models reject, strips sampling parameters where
rejected, and sizes max output tokens correctly.
