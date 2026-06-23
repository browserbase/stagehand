---
"@browserbasehq/stagehand": patch
---

Fix non-CUA `agent.execute()` reporting a successful run as failed. After the agent finished all of its work, the forced "done" finalization step (`handleDoneToolCall`) re-submitted the accumulated run history to the model; with some providers (e.g. reasoning models like `openai/gpt-5.x`) that history is rejected by the AI SDK (`Invalid prompt: messages must be a ModelMessage[]`), which surfaced as a red error and flipped the result to `{ success: false }` even though every action had already completed.

The finalization "done" call is now best-effort: if it throws, the agent logs a warning (with the underlying cause) and synthesizes a completion from the run instead of failing it. Also hardens `handleDoneToolCall` against a missing `toolCalls` array.
