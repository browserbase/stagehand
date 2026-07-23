---
"@browserbasehq/stagehand": minor
---

Add Vertex AI support for Google Computer Use Agents. The `vertex` provider (explicit, or a `vertex/` model prefix) routes Google CUA models through Vertex AI, initializing `@google/genai` in Vertex mode with service-account, express-mode API key, or ambient ADC auth. `VertexModelConfigObject.auth` and `.providerOptions` are now individually optional, since express keys and ADC need neither.
