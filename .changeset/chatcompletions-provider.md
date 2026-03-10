---
"@browserbasehq/stagehand": minor
"@browserbasehq/stagehand-server-v3": minor
---

feat: add `chatcompletions` provider prefix and `modelBaseURL` support for OpenAI-compatible endpoints

Adds a `chatcompletions/` model name prefix that forces the Chat Completions API (`/chat/completions`) instead of the Responses API (`/responses`), enabling support for OpenAI-compatible providers like ZhipuAI GLM. Also threads `modelBaseURL` through the server so SDKs can point to custom LLM endpoints.
