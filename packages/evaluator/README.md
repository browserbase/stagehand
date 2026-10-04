# Evaluator

Browser-free verifier for a saved trajectory and rubric. The library uses recorded
text and screenshots plus judge inference; it does not fetch external facts.

```sh
pnpm --filter @browserbasehq/stagehand-evaluator build
node packages/evaluator/dist/cli.js /path/to/saved/run --json \
  --model google/gemini-3.8-flash --trace /tmp/new-verifier-trace.jsonl
```

The directory must contain `trajectory.json` in the existing evals format.
Relative screenshot files are hydrated locally. `--rubric file.json` overrides
the embedded rubric; `--generate-rubric` generates one from the task instead.
`--out` and `--trace` only create new files, never overwrite existing ones.
The default command does not alter the saved run. The existing `evals verify`
command remains available for the host-side Harbor adapter.

```ts
import { Evaluator, loadTrajectoryFromDisk } from "@browserbasehq/stagehand-evaluator";

const evaluator = new Evaluator({ modelName: "google/gemini-3.8-flash" });
await evaluator.validate(); // Before starting a batch or allocating a browser.
const result = await evaluator.verify(await loadTrajectoryFromDisk(runDirectory));
```

Model precedence: explicit option, `EVAL_VERIFIER_MODEL`, then
`STAGEHAND_EVALUATOR_MODEL`, then `google/gemini-3.8-flash`. `VERIFIER_RUBRIC_MODEL`
can select a separate rubric model. Existing `VERIFIER_*` budget/approach knobs
are preserved. The default text budget is 24,000 tokens; selected chunks retain
their complete content and provenance. `VERIFIER_EVIDENCE_MODE=legacy` retains
the old evidence-selection path for controlled comparisons.

Direct providers currently supported: `google/…` (Google/Gemini API key) and
`openai/…` (`OPENAI_API_KEY`). Anthropic, Bedrock, and Ollama judge providers are
not ported. A custom `LLMClient` can be injected by library consumers.

Results preserve the previous outcome/process fields and add:

- `outcomeState`: `supported`, `contradicted`, or `unresolved`. Only supported passes.
- `outcomeChecks`: evidence and states for critical-point boundaries, identity
  and constraints, and final-deliverable completeness.
- `health`: versioned verifier status and stage-specific errors. A non-healthy
  result is an ungraded/error result, not an ordinary negative reward.
- `execution`: termination reason, execution issues, and the browser-use rule
  that fired (`recorded-server`, documented legacy name fallback, or `none`).
- `failureClass`: the first recorded execution issue, which may coexist with
  a successful outcome if completion preceded a disconnect.

The CLI always emits JSON. Exit 0 means grading completed, including ordinary
task failures; exit 1 means input/startup failure; exit 2 means degraded or failed
verification. Consume `health` directly instead of matching reasoning text.

Opt-in knobs (defaults unchanged; measured in `EVALUATOR_V4_NOTES.md`):

| Variable                                              | Effect                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VERIFIER_IMAGE_SELECTION`                            | `llm` (default) scores every screenshot for relevance in batched LLM calls; `recency` attaches the latest frames; `signals` picks frames from trajectory signals (answer anchors, state-changing actions, page entry/exit, text-poor steps, criterion hits) with zero extra LLM calls. |
| `VERIFIER_SIGNAL_IMAGES` / `VERIFIER_RECENT_IMAGES`   | Frame budget for `signals` (default 10) / `recency` (default 4).                                                                                                                                                                                                                       |
| `VERIFIER_THINKING_BUDGET`                            | Caps judge reasoning tokens (Google `thinkingConfig`).                                                                                                                                                                                                                                 |
| `VERIFIER_CALL_TIMEOUT_MS` / `VERIFIER_CALL_ATTEMPTS` | Per-attempt judge timeout (default 60000) and attempts (default 2).                                                                                                                                                                                                                    |
| `VERIFIER_OCR_CMD`                                    | Optional command that OCRs screenshots into observation-tier text (`scripts/ocr-macos.swift`); cached by image hash.                                                                                                                                                                   |
| `VERIFIER_REQUIREMENTS`                               | `1` verifies a cached per-task requirement checklist inside the judgment call.                                                                                                                                                                                                         |
| `VERIFIER_UNRESOLVED_BLOCKS`                          | `0` lets only contradicted checks veto a judge pass.                                                                                                                                                                                                                                   |

`scripts/replay.mjs` checks frozen input hashes and stamps the actual compiled
build, config, model, and manifest. `scripts/report.py` reports ungated judge and
gated production baselines separately, with confidence tables and per-row flips.
See the repository's `EVALUATOR_V4_NOTES.md` for the calibration protocol and limits.
