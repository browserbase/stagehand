---
"@browserbasehq/stagehand": patch
---

Normalize URLs in `ActCache` key derivation by sorting query parameters before hashing. Semantically equivalent URLs that differ only in parameter order (e.g. `?utm_source=email&id=42` vs `?id=42&utm_source=email`) now hit the cache instead of silently missing. Fragments and duplicate keys are preserved.
