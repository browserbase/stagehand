---
"@browserbasehq/stagehand": minor
"@browserbasehq/stagehand-server-v3": minor
"@browserbasehq/stagehand-server-v4": minor
---

feat: add `chatcompletions` provider prefix and `modelBaseURL` support for OpenAI-compatible endpoints

Adds a `chatcompletions/` model name prefix that forces the Chat Completions API (`/chat/completions`) instead of the Responses API (`/responses`), enabling support for OpenAI-compatible providers like ZhipuAI GLM. Also adds `modelBaseURL` support end-to-end: client SDK sends `x-model-base-url` header, both server-v3 and server-v4 extract and thread it, and Stainless generates it as an optional parameter across all language SDKs.
