---
"@browserbasehq/stagehand-extension": patch
"@browserbasehq/stagehand": patch
"@browserbasehq/stagehand-python": patch
---

pr: #3422
commit: b29016565dc83dc4f0e56948fb11210dce7e4df0
author: @aryansahai22

fix response header lookups reporting a header with an empty value as missing on HTTP/2 responses
