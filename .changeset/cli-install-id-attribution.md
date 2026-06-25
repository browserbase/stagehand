---
"browse": patch
---

Attribute CLI-driven Browserbase usage to an anonymous install. Remote browser sessions now stamp `install_id` and `cli_version` (alongside `browse_cli`) onto `userMetadata`, and cloud Search/Fetch requests send `x-bb-client` and `x-bb-install-id` headers. The install id reuses the existing anonymous telemetry marker; resolution is best-effort and never blocks or fails a command.
