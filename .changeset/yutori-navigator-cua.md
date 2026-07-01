---
"@browserbasehq/stagehand": patch
---

Add Yutori Navigator n1.5 as a computer-use (CUA) agent provider, usable via `stagehand.agent({ mode: "cua", model: "yutori/n1.5-latest" })`. Navigator is an OpenAI-compatible computer-use model (core coordinate tool set) integrated alongside the existing OpenAI/Anthropic/Google/Microsoft CUA clients, with no new dependencies. Auth via `YUTORI_API_KEY`, or `apiKey`/`baseURL` in the agent model client options.

Supports the standard Stagehand agent surface: custom user tools via `agent({ tools })`, structured output via `execute({ output })`, and `execute({ excludeTools })` (mapped to Navigator's `disable_tools`).
