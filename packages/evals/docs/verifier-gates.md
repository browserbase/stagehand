# Verifier evidence gates

External harnesses use the existing V3 verifier with the task's precomputed rubric when available. A requested verification that errors or returns a verifier-uncertainty sentinel fails closed: `_success` is false, `verifierError` explains the failure, and `agentReportedSuccess` preserves the original self-report. Such rows are ungraded and must not be presented as verified benchmark outcomes.

The raw judge verdict is retained under `judge` in `scores/result.json`. The top-level result, `task_data.json`, and the run row carry the same adjusted outcome. `scores/gates.json` records diagnostics when trajectory persistence is enabled.

## Outcome

A judge pass is rejected when the final answer is empty or, if a mounted-tool matcher is available, the trajectory has no browser tool calls. Grounding checks are advisory by default. `EVAL_REQUIRE_GROUNDING=1` additionally rejects an answer whose checked numeric findings all lack matching non-search-page observations. The check is a text heuristic: images, paraphrases and valid snippet sources can escape its matching, so it is not a replacement for rubric verification.

Execution state remains separate. `harnessStatus`, `harnessStopReason` and `terminationReason` distinguish completion, budget exhaustion, abort, SDK error and browser loss. A supported task completion can still pass after a disconnect; execution error alone does not erase earlier evidence. An unfinished task must fail its rubric.

## Process

`processScoreStrict` recomputes the weighted process score with explicit `evidenceInsufficient` criteria earning zero while retaining their maximum points in the denominator. `processScore` uses this score; `processScoreLenient` preserves the judge's aggregate. Not-applicable criteria are excluded. Without a criterion breakdown, the judge's aggregate is retained and `scoringIncomplete` flags a short result against the rubric.

Blocker wording is recorded as `blockerMentioned` on criterion diagnostics. It never changes points by itself: permitted fallback and stop-boundary explanations can correctly mention a blocker. The rubric and observed evidence determine whether the requirement was satisfied. This replaces the campaign's overbroad blocker substring heuristic.

## Reporting

- `facade_tool_calls` and `facade_tool_call_failures` count attempted and failed browser work. Run-level browser loss comes from runner-owned telemetry. Normalized steps do not provide trusted per-call loss attribution, so tool-output text cannot exclude failures or synthesize a count after session loss.
- Agent, evidence-capture and verifier wall times are reported separately.
- Normalized usage records the SDK's cache convention. Missing usage is unavailable; historical Cursor CLI records remain unreported.
- `cost_source=reported` means the harness reported dollars. `computed` is an estimate using the dated catalog snapshot in `pricing/pricing.json`; it is not an invoice. Unknown or subscription costs are unavailable, never inferred as zero.
- `harnessImplementation` records adapter and SDK versions when supplied. Its absence in older records means unknown implementation; historical labels are preserved.

Use `VERIFIER_PERSIST_TRAJECTORIES=1` for reviewable evidence. HardBench's compatibility gate rejects verifier errors, uncertainty sentinels, missing criteria and self-report fallbacks before accepting a result. Offline transport checks establish integration compatibility; live rubric accuracy still requires the separately recorded live fixtures.
