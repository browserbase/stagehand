---
"@browserbasehq/stagehand": patch
---

Support models that reject forced tool use (e.g. Claude Fable 5) across `act`/`extract`/`observe` and the agent. The AI SDK emulates `generateObject` for Anthropic with a forced `json` tool, and the agent forces a final `done` tool call — both of which these models reject with "tool_choice forces tool use is not compatible with this model". We now detect that error and retry: `generateObject` falls back to Anthropic's native structured outputs (`structuredOutputMode: "outputFormat"`) with a strict JSON schema, and the agent's `done` call retries with `toolChoice: "auto"`. The structured-output fallback is cached per model so subsequent calls skip the failed forced attempt.
