---
"@browserbasehq/stagehand-protocol": minor
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand-python": minor
"@browserbasehq/stagehand-go": minor
"@browserbasehq/stagehand": minor
---

Accept any nonempty model ID under the OpenAI, Anthropic, and Google provider prefixes without a Stagehand release. Unknown model IDs now fail on the provider request instead of during configuration validation. Public model ID types widen from literal unions to strings. Examples and generated schema samples use current provider IDs such as `openai/gpt-6-luna`, `anthropic/claude-sonnet-5-5`, and `google/gemini-3.8-flash`.
