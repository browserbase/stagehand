# Verifier evidence gates

External harnesses use the existing V3 verifier with the task's precomputed rubric when available. A requested verification that errors or returns a verifier-uncertainty sentinel fails closed: `_success` is false, `verifierError` explains the failure, and `agentReportedSuccess` preserves the original self-report. Such rows are ungraded and must not be presented as verified benchmark outcomes.

For completed grades, the raw judge verdict is retained under `judge` in `scores/result.json`. The top-level result, `task_data.json`, and the run row carry the same adjusted outcome. Failed or uncertain verification instead persists `{ graded: false, verifierError, judge? }`, without top-level outcome or process scores; `judge` is present only if the verifier returned a response. `scores/gates.json` records diagnostics for completed grades when trajectory persistence is enabled.

## Outcome

A judge pass is rejected when the final answer is empty or, if a mounted-tool matcher is available, the trajectory has no browser tool calls. Grounding checks are advisory by default. `EVAL_REQUIRE_GROUNDING=1` additionally rejects an answer whose checked numeric findings all lack matching observations from a known non-search page. Captured step and terminal accessibility trees are included; unknown-page text cannot establish grounding. A terminal match is recorded as `groundedAtFinalObservation`, while untrusted matches can be recorded as `seenOnUnknownPage`. The check is a text heuristic: images, paraphrases and valid snippet sources can escape its matching, so it is not a replacement for rubric verification.

Execution state remains separate. When populated by the runner or adapter, `harnessStatus`, `harnessStopReason` and `terminationReason` describe completion, budget exhaustion, abort, SDK error and browser loss. The verifier does not synthesize missing lifecycle metadata; its absence means unavailable. A supported task completion can still pass after a disconnect; execution error alone does not erase earlier evidence. An unfinished task must fail its rubric.

## Process

`processScoreStrict` recomputes the weighted process score with explicit `evidenceInsufficient` criteria earning zero while retaining their maximum points in the denominator. `processScore` uses this score; `processScoreLenient` preserves the judge's aggregate. Not-applicable criteria are excluded. Without a criterion breakdown, the judge's aggregate is retained and `scoringIncomplete` flags a short result against the rubric.

Blocker wording is recorded as `blockerMentioned` on criterion diagnostics. It never changes points by itself: permitted fallback and stop-boundary explanations can correctly mention a blocker. The rubric and observed evidence determine whether the requirement was satisfied. This replaces the campaign's overbroad blocker substring heuristic.

## Reporting

These fields depend on the producing runner; this verifier layer forwards them but does not make every harness emit them:

- Where supplied, `facade_tool_calls` and `facade_tool_call_failures` count attempted and failed browser work. Missing counters are unknown, not measured zero. Run-level browser loss comes from runner-owned telemetry. Normalized steps do not provide trusted per-call loss attribution, so tool-output text cannot exclude failures or synthesize a count after session loss. A graded pass with an explicit zero browser-call count is shown in the batch summary; with `EVAL_MAX_UNVERIFIABLE_CRITERIA` enabled, it fails the batch gate.
- Separate agent, evidence-capture and verifier wall times are available only when recorded by the producer.
- Usage must be interpreted with the producer's presence marker and cache convention. Legacy runners may supply zero placeholders; without an explicit presence marker, zero does not establish measured usage. Historical Cursor CLI usage remains unreported.
- A producer's `cost_source` distinguishes reported dollars from a catalog estimate (`computed`). Shared runner estimates use the dated catalog in `pricing/pricing.json`; they are not invoices. This verifier layer does not compute estimates. Without provenance, cost origin is unavailable; unknown, tier-dependent or subscription costs must not be inferred as zero.
- `harnessImplementation` records adapter and SDK versions when supplied. Its absence means unknown implementation; historical labels are preserved.

Use `VERIFIER_PERSIST_TRAJECTORIES=1` for reviewable evidence. HardBench's compatibility gate rejects verifier errors, uncertainty sentinels, missing criteria and self-report fallbacks before accepting a result. Offline transport checks establish integration compatibility; live rubric accuracy still requires the separately recorded live fixtures.
