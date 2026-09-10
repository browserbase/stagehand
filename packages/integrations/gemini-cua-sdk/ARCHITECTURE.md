# gemini-cua-sdk

This package runs Gemini Computer Use against a Stagehand facade browser. The
session owns the `generateContent` loop and transcript; the executor translates
the provider's coordinate and keyboard actions into facade `run` calls. Each
response cycle returns one fresh screenshot and the current URL as a
`functionResponse`, and provider usage metadata is retained per step.

The evals `gemini_cua` harness mounts only `google_computer_use`; it uses the same runner-owned facade bridge and browser identity as other mounted harnesses. The native SDK calls the canonical facade capability types through the shared CUA decoder, not a separate browser implementation.

The common evaluation policy is sent once via `config.systemInstruction`, the installed Google SDK request field. `config.abortSignal` cancels the active client request; aborts also stop retry waits and are checked before browser initialization and between actions. A terminal browser loss ends the session without retrying screenshots. Transient observation failures retain the existing one-retry behavior. Eval cleanup is bounded and idempotent.

Budgets count API turns, which can contain multiple tool calls. `EVAL_GEMINI_CUA_MAX_TURNS` overrides the shared or dataset budget. The exact per-action response and image sent to the model are retained on the tool-result event and attached by tool-use ID, so failed calls do not shift observations. The eval adapter uses these returned images rather than capturing another screenshot for each action. Historical index-based observations remain readable by the trajectory adapter. Input/cache/output/reasoning counters retain the provider's separate fields for shared usage normalization.

Coordinate actions use a 1288×711 viewport and Gemini's normalized coordinates. The executor supports the provider actions listed in its switch; unknown actions return explicit errors. It does not add facade reconnection or alternate browser ownership.

Browser gestures use the existing SDK Page primitives through the common facade. Drag uses `dragAndDrop` with two movement steps, preserving the midpoint before the endpoint. Gemini `hotkey` arrays form a single key chord; `wait` honors its seconds argument (default 1), while the legacy `wait_5_seconds` remains 5 seconds. The current `scroll` action defaults to 300 pixels, and legacy `scroll_at` keeps its 800-pixel default.

Blocked, truncated, malformed, missing, and empty terminal responses are recorded as SDK errors with their response events and usage preserved. No action from a truncated response is executed, and incomplete text is not reported as a completed task.

Terminal loss is determined by the core facade error class or the runner-owned loss getter, never a page or agent error string. Malformed function-call batches fail before any call executes. Model identifiers are forwarded to the native provider for validation, stripping only the optional `google/` catalog alias. Session failures use sanitized `HarnessAdapterError` values.

An explicit empty final answer remains empty, and a tool call without a result is unsuccessful. If terminal evidence has no screenshot, the last model-visible tool image is retained alongside available final metadata; it represents the last captured frame, not a new terminal capture.
