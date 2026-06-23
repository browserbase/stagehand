---
"@browserbasehq/stagehand": patch
---

Fix non-CUA `agent.execute()` reporting a successful run as failed. After the agent finished all of its work, the forced "done" finalization step (`handleDoneToolCall`) re-submitted the accumulated run history to the model. With some providers (notably reasoning models like `openai/gpt-5.x`) that history carries nested `undefined` values inside `providerOptions`, which the AI SDK rejects (`Invalid prompt: messages must be a ModelMessage[]`, since `providerOptions` leaves must be JSON values). That surfaced as a red error and flipped the result to `{ success: false }` even though every action had already completed.

The run history is now sanitized (nested `undefined` stripped, equivalent to a JSON round-trip) before the forced "done" call, so it succeeds and structured `output` is preserved. As defense-in-depth, the finalization step is also best-effort: if it still throws, the agent logs a warning and synthesizes a completion instead of failing the run. Also hardens `handleDoneToolCall` against a missing `toolCalls` array.
