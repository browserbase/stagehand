---
"@browserbasehq/browse-cli": minor
---

browse env local now auto-discovers existing Chrome instances with remote debugging enabled, attaching to them instead of always launching an isolated browser. Falls back to isolated launch when no debuggable Chrome is found. Added --isolated flag, positional CDP target argument, and --ws now accepts bare port numbers.
