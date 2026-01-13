---
"@browserbasehq/stagehand": patch
---

fix: replaying cached actions (for agent & act) now uses the originally defined model, (instead of default model) when action fails and rerunning inference is needed
