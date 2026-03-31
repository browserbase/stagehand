---
"@browserbasehq/browse-cli": patch
---

Add `browse get markdown [selector]` command to convert page HTML to markdown. Defaults to body content, supports optional selector for specific elements. Uses node-html-markdown for high-quality conversion with links, tables, and code blocks preserved.
