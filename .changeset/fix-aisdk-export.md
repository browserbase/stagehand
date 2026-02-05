---
"@browserbasehq/stagehand": patch
---

Fix AISdkClient export to include getLanguageModel() method

The public API was exporting the outdated example version of AISdkClient from `examples/external_clients/aisdk.ts` which lacks the `getLanguageModel()` method required for v3 Agent integration.

This fix changes the export to use the production AISdkClient from `lib/v3/llm/aisdk.ts` which includes full AI SDK support including:
- `getLanguageModel()` method for Agent compatibility
- Proper streaming support
- Full AI SDK integration

**Breaking change mitigation:** The old example AISdkClient was functionally identical for non-Agent use cases (act, extract, observe), so this change is backwards compatible for those operations. Only Agent workflows are affected, and they were previously broken.

**Impact:** Customers can now use custom model providers (like ZhipuAI, DeepSeek, or any OpenAI-compatible endpoint) with v3 Agent using the `createOpenAI` provider pattern.
