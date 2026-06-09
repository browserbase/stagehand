---
"@browserbasehq/stagehand": patch
---

Add Yutori Navigator n1.5 as a computer-use (CUA) agent provider, usable via `stagehand.agent({ mode: "cua", model: "yutori/n1.5-latest" })` (auth via `YUTORI_API_KEY`). OpenAI-compatible computer-use model integrated alongside the existing OpenAI/Anthropic/Google/Microsoft CUA clients; ships the core tool set with no new dependencies.
