---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

Add opt-in `stagehand.experimentalDecisions` in TypeScript and `stagehand.experimental_decisions` in Python for actions, observation and extraction, with automatic LLM fallback for unsupported or uncertain requests. Ordinary methods keep LLM inference.

Configure decision-provider credentials, an optional model and required connection metadata. The default is Perplexity Decider v1.3; TypeSafe and Cloudflare are also supported. LLM fallback requires separate model credentials or a Browserbase gateway.

Ground explicit hovers and literal email fills in the selected page controls. Verify text edits on the selected element, check covered pointer targets after scrolling, and read split scientific notation for numeric extraction fields.

Verify link destinations and copy complete table rows when supported. For custom clicks, check the handler and the element receiving input. Report partial completion when a follow-up action is unavailable.
