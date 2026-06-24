---
"@browserbasehq/stagehand": patch
---

Fix non-CUA `agent.execute()` reporting a successful run as failed. After the agent finished all of its work, the forced "done" finalization step (`handleDoneToolCall`) re-submitted the accumulated run history to the model. When a custom tool returned an object with an optional field left `undefined` (e.g. `{ matchedExpected: undefined }`), that `undefined` ended up inside a tool-result `output.value`, which the AI SDK's prompt validation rejects (its JSON-value schema disallows `undefined`), throwing `Invalid prompt: messages must be a ModelMessage[]`. This surfaced as a red error and flipped the result to `{ success: false }` even though every action had already completed (STG-2335).

Root cause fix: deep-strip `undefined` values from the run history before re-submitting it to the forced "done" finalization call, keeping the messages valid without dropping any real content. Class instances (URL, typed arrays for binary data, etc.) are passed through untouched.
