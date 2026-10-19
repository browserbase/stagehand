# Pi SDK adapter

The adapter uses Pi 1.3.0's built-in MCP extension for stdio mounts. Servers use
`direct` exposure so their tools are declared to the model. Code surfaces keep
an in-process `run` tool. Browser calls execute sequentially, with Pi's file and
shell tools disabled and its `codemode` extension unloaded.

SDK sessions bind extensions explicitly to start MCP connections. Disposal emits
`session_shutdown`, awaits MCP cleanup, then disposes the session. Eval resources
are isolated from user and project extensions; model authentication still uses
Pi's model runtime.

## Event retention

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

Native MCP results contain both model-facing content and the original wire result.
Retained events decode screenshot content once and replace duplicate wire image
payloads with size markers. The eval trajectory reads browser output from the
wire result rather than Pi's routing metadata.
