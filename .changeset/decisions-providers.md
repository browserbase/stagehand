---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand-go": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

The experimental `experimentalDecisions` path can use other decision models: `provider: "cloudflare"` (Clef on Workers AI, needs `accountId`), `"perplexity"` (Decider) or `"openai"` (Decisions API preview), next to the default `"typesafe"` (Jev). Answers from every provider are validated before they are acted on.
