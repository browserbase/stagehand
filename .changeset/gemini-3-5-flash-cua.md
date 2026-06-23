---
"@browserbasehq/stagehand": minor
---

Add support for the `google/gemini-3.5-flash` computer-use agent model. The Google CUA client now maps Gemini 3.x predefined function names onto the canonical 2.5 handlers, tolerates the 3.x argument shapes (coordinate-less type, keys arrays, scroll magnitude, drag start/end pairs), treats take_screenshot as a no-op, and always returns a screenshot observation even on a turn with no executable actions.
