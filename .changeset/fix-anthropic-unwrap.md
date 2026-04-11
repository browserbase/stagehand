---
"@browserbasehq/stagehand": patch
---

fix: unwrap tool parameter name wrapper in Anthropic responses

Some Anthropic models wrap tool_use responses in a parameter name key (e.g. `{$PARAMETER_NAME: {actual data}}`), causing Zod schema validation to fail with `AI_NoObjectGeneratedError`. Added defensive unwrapping in both `AISdkClient` and `AnthropicClient` code paths.
