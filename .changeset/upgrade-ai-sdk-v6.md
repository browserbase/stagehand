---
"@browserbasehq/stagehand": minor
---

Upgrade AI SDK from v5 to v6 and all providers to their latest major versions. Migrates to LanguageModelV3, replaces deprecated generateObject/streamObject with generateText/streamText + Output.object(), and updates all agent tool toModelOutput signatures. Backwards-compatible shims preserve the existing LLMClient API surface.

**Breaking:** AISdkClient constructor now requires LanguageModelV3 instead of LanguageModelV2. Users must upgrade their @ai-sdk/* provider packages to v3+.
