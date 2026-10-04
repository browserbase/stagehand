# Pi SDK harness

The eval harness embeds Pi 1.0's TypeScript SDK. SDK sessions do not load the CLI's
built-in extensions, so MCP mounts add `createMcpExtension()` and call
`session.bindExtensions()` so registered servers connect on `session_start`.

Eval MCP mounts use `exposure: "direct"` so the model calls `mcp__<server>__<tool>`
like a built-in tool. Built-in file tools (`read`, `bash`, `edit`, `write`) are
disabled with `noTools: "builtin"`, matching the other eval harnesses that
allowlist only the mounted browser tools. Pi's own `codemode` tool is not loaded:
Stagehand already exposes browser code execution through `run` / handle mounts.

The session retains screenshot evidence up to 8 MiB per image and 64 MiB across
one run. It checks the encoded size before allocating a decoded buffer. Images
within those limits remain usable screenshot bytes; images exceeding either
limit become an explicit text omission marker in the retained trajectory. The
marker contains no image payload for downstream adapters to decode again.

These limits apply to the harness's retained evidence. They do not change the
tool result the model receives or bound Pi's own upstream message storage.
Whitespace-heavy or otherwise noncanonical base64 may be rejected conservatively.

Normal completed-event logs are debug detail. Tool/provider failures stay visible
at level 1; log summaries redact credentials before applying their text limit.
