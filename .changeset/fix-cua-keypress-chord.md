---
"@browserbasehq/stagehand": patch
---

Fix CUA `keypress` actions to press key combinations as a single chord. Previously each key in the array was pressed separately, releasing modifiers before the main key — so combinations like `["Control", "A"]` sent Ctrl on its own and then typed a literal `a` instead of select-all. This affected the OpenAI, Google (`key_combination`), and Microsoft computer-use clients, which emit multi-element key arrays; Anthropic (which sends a single `+`-joined string) was unaffected.
