# Cursor SDK harness

The `cursor` evaluation harness uses `@cursor/sdk` with the runner's supplied MCP
mount. It does not launch the Cursor CLI or read its global MCP configuration.
The SDK receives only MCP tools and disables inherited setting sources.

Each new run records `harnessImplementation` with the adapter name (`sdk`),
adapter version and installed SDK version. Older `cursor` and `cursor_sdk`
trajectories remain readable; missing implementation metadata is not inferred
to mean SDK execution. Historical CLI token usage remains unreported.

Evaluation policy is prefixed to the task once. Cursor SDK's `systemPrompt`
option replaces its complete stock prompt and requires server entitlement, so
the harness preserves the default system prompt. Claude/Gemini native harnesses
have their own system channels.

The session owns cancellation and disposal, including handles that arrive after
an abort. `events.ts` decodes both historical CLI envelopes and normalized SDK
events without retaining a CLI execution path.
