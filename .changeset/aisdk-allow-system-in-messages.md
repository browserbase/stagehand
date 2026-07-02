---
"@browserbasehq/stagehand": patch
---

Silence the AI SDK "System messages in the prompt or messages fields can be a security risk" warning emitted on every hybrid/DOM `agent.execute()` call.

The agent loop intentionally supplies its system prompt as a system-role message (rather than the top-level `system` param) so it can carry Anthropic ephemeral cache-control via `providerOptions`. AI SDK v5 warns whenever it sees a system message inside `messages`, since it can't tell a trusted system prompt from untrusted input. Because the prompt is Stagehand's own, we now pass `allowSystemInMessages: true` to the `generateText`/`streamText` calls, which keeps prompt caching intact and removes the noisy warning. Bumps the `ai` floor to `^5.0.185`, where this option is available.
