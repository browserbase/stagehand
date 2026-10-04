---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand-go": patch
"@browserbasehq/stagehand": patch
---

Internal: `act()`, `observe()` and `extract()` take an injected driver. The language model and the experimental decision model are two driver families behind one contract, composed by the controller; behaviour of the public methods is unchanged.
