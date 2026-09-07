# gemini-cua-sdk

This package runs Gemini Computer Use against a Stagehand facade browser. The
session owns the `generateContent` loop and transcript; the executor translates
the provider's coordinate and keyboard actions into facade `run` calls. Each
response cycle returns one fresh screenshot and the current URL as a
`functionResponse`, and provider usage metadata is retained per step.

The evals `gemini_cua` harness mounts only `google_computer_use`; it uses the same runner-owned facade bridge and browser identity as other mounted harnesses. The native SDK calls the canonical facade capability types through the shared CUA decoder, not a separate browser implementation.

The common evaluation policy is sent once via `config.systemInstruction`, the installed Google SDK request field. `config.abortSignal` cancels the active client request; aborts also stop retry waits and are checked before browser initialization and between actions. A terminal browser loss ends the session without retrying screenshots. Transient observation failures retain the existing one-retry behavior. Eval cleanup is bounded and idempotent.

Budgets count API turns, which can contain multiple tool calls. The exact per-action response and image sent to the model are retained on the tool-result event and attached by tool-use ID, so failed calls do not shift observations. The eval adapter uses these returned images rather than capturing another screenshot for each action. Historical index-based observations remain readable by the trajectory adapter. Input/cache/output/reasoning counters retain the provider's separate fields for shared usage normalization.

Coordinate actions use a 1288×711 viewport and Gemini's normalized coordinates. The executor supports the provider actions listed in its switch; unknown actions return explicit errors. It does not add facade reconnection or alternate browser ownership.
