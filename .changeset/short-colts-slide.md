---
"@browserbasehq/stagehand": minor
---

previously it throws StagehandDefaultError if there is no LLM api key present which doesn't give a clear understanding of the error. In this change it will provide a concise error info that key is invalid.
