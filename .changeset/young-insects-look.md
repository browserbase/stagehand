---
"@browserbasehq/stagehand": minor
---

Added CerebrasClient.ts:

- Handles API communication with Cerebras
- Supports function calling
- Includes robust response parsing with fallbacks
- Handles caching and error logging
- Infrastructure Changes:

Updated LLMClient.ts to support Cerebras provider type:

- Added Cerebras models to model.ts type definitions
- Added Cerebras case to LLMProvider.ts
- Added CEREBRAS_API_KEY to environment variables
