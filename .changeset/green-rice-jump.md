---
"@browserbasehq/stagehand": patch
---

Fix file input handling in `observe` context so upload inputs are preserved and can be reliably targeted by XPath.

Also adds an eval and example showing the upload flow:
1. use `observe` to find the file input,
2. unpack the returned XPath,
3. call `page.locator(xpath).setInputFiles(...)`.
