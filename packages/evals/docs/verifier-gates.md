# Verifier outcome gates

`packages/evals/framework/verifierGates.ts` applies deterministic, model-free
checks on top of the `V3Evaluator` verdict for every external-harness run
(`gradeExternalTrajectory` in `verifierAdapter.ts`). The judge's raw verdict is
always preserved; the gates only ever flip a pass to a fail.

## Why

A 65-row adversarial audit of HardBench runs (2026-08-31, `gpt-5.6-luna`
across eve / deepagents / codex / mastra / fx / claude_code) found the judge
passing rows that the trajectory itself contradicts:

| Case | Row                                | What the judge saw                          | What the trajectory says                                                            |
| ---- | ---------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------- |
| a    | deepagents `7e6993f2` (imgur meme) | outcome=true, process=1.0                   | `status: "error"`, `finalAnswer: ""`, 51 steps (budget exhausted)                   |
| b    | eve `airasia_88`                   | outcome=true, process=0.92                  | "SGD 5" appears only in Google/Scribd snippet text; airasia.com never showed a fare |
| c    | eve `afcebfed` (CVS gluten-free)   | outcome=true, process=1.0                   | gluten-free constraint never verified (judge's job; gates leave this alone)         |
| d    | every `a0a18ca6` (Macy's bot wall) | process=1.0                                 | all 7 criteria credited "due to the uncontrollable blocker"                         |
| e    | assorted                           | explanation decides "criterion 1: 2 points" | structured `perCriterion` shorter than the rubric                                   |

## Gates (`outcomeGates`)

`outcomeSuccess := judgeOutcomeSuccess AND none of:`

| Gate                | Fires when                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `no_final_answer`   | `trajectory.finalAnswer` is empty/whitespace                                                                                    |
| `trajectory_error`  | `trajectory.status === "error"`                                                                                                 |
| `no_browser_use`    | a facade tool matcher is available and zero steps match it (e.g. fx answering via `web_fetch`)                                  |
| `ungrounded_answer` | grounding is required (below) and the answer contains numeric datums, none of which appear in any non-search-engine step output |

Surfaced on the `TaskResult` as `judgeOutcomeSuccess`, `outcomeGates`, and the
metric `outcome_gated` (0/1). When trajectories are persisted the full gate
record is written to `scores/gates.json` beside the judge's `result.json`.

## Strict process score

`processScore` (what `--success process` reads) is now the strict score;
the judge's aggregate is kept as `processScoreLenient`.

A criterion is marked `blocked: true` in the copied `perCriterion` and scored
0 when either:

- the judge flagged it `evidenceInsufficient` (per-criterion flag or the
  top-level list), or
- it earned full points and its explanation matches
  `/uncontrollable|blocker|could not be attempted|blocked/i`.

Blocked criteria stay in the denominator. Dropping them would give a fully
bot-walled run 0/0, and any fallback there lets it pass `--success process`
again. Partial credit that merely mentions a blocker is not zeroed. Without a
`perCriterion` breakdown the strict score falls back to the judge's aggregate.

Known over-reach: a criterion that was genuinely completed but whose
explanation mentions the blocker (e.g. "Respect Critical Point boundaries — the
agent did not cross any boundary as it was blocked") is also zeroed. Accepted
as the conservative direction.

## Grounding check

Controlled by `EVAL_REQUIRE_GROUNDING`. Default `1` when the task ships a
precomputed rubric or the dataset matches `/hardbench|webtailbench/i`, else
`0`. When `0` the check still runs and is reported; it just cannot gate.

1. Extract datums from `finalAnswer`: currency amounts (`SGD 5`, `$18.95`,
   `5 SGD`), percentages, clock times (`1:27:02.624`), decimals, integers,
   and capitalised multi-word entities.
2. Only currency / percent / time / decimal / 4+ digit integers can gate.
   Short integers (`1)`, `50+`), years (`19xx`/`20xx`), entities, and any
   datum that appears verbatim in the task instruction are advisory only.
3. Each step's page is its `probeEvidence.url`, else the first URL in
   `actionArgs`, else the first URL in the tool output; steps without a hint
   inherit the previous step's page. A page on `google.`, `bing.`,
   `duckduckgo.`, `yahoo.`, `scribd.`, or `reddit.` is a search engine.
4. A datum is grounded if it matches (case-insensitive, comma-insensitive,
   space-tolerant, digit-bounded) in the tool output or text evidence of a
   non-search-engine step. Currency matches accept aliases (`S$5`, `SGD 5.00`)
   and, for specific amounts, the bare number.
5. The gate fires only when **no** gating datum is grounded. A row whose
   headline figure was verified on the target site is never failed because a
   secondary comparison figure came from a snippet or screenshot.

Result on the `TaskResult`: `grounding: { checked, ungrounded, groundedNumeric,
ungroundedNumeric, gatesOutcome }`, metric `answer_grounded` (0/1, emitted only
when there was something to check).

### Tuning evidence (84 persisted HardBench rows)

39 judge passes → 27 gated passes. Every flip was hand-checked:

- `airasia_88` eve: both `SGD 5` / `SGD 10` appear only in Google/Scribd steps.
- `7e6993f2` deepagents: `no_final_answer` + `trajectory_error`.
- `864244b6` (F1 race time), 6 of 7 passes: `1:27:02.624` appears only inside
  Google/Bing snippet text ("Winner VER 1:27:02.624" quoted from espn.com by
  Google). Only the mastra run actually loaded the ESPN results page. Two of
  the six clicked the ESPN result but the tool output still shows Google's AI
  Overview — the click did not navigate.
- `47e314cc45` eve: `$5` permit price only in a Google snippet.
- `47e314cc45` fx: `no_browser_use` (all 12 steps `web_fetch`).
- `84f806c7` deepagents: answered "Animal Care Centers of NYC … 10029" — the
  name and zip appear in no step output at all (prior knowledge).

Not gated, as required: `92160852` (UPS `$18.95` grounded on ups.com in every
pass), `afcebfed` (CVS prices grounded on cvs.com), `84f806c7` Empty Cages
Collective passes (`2.4`, `11222` grounded on adoptapet.com).

## Scoring completeness

`scoringIncomplete: true` (metric `scoring_incomplete`) when the rubric has
more items than `perCriterion` entries. Does not alter the outcome.

## Upstream issues to file against the v3 verifier (`stagehand-v3` 3.7.x)

1. **Blocker credit leaks into the outcome.** `prompts/fusedJudgment` awards
   full process credit for criteria behind an "uncontrollable blocker" and for
   `evidenceInsufficient` criteria. Bot-walled runs report `processScore: 1.0`
   and the same reasoning carries `outcomeSuccess: true` for runs with no
   answer (case a) or a snippet-lifted answer (case b). Outcome should require
   evidence of the answer on the target surface; process credit for blocked
   criteria should be separable (a `blocked` flag on `CriterionScore`).
2. **`perCriterion` drops judged criteria.** The fused judgment's free-text
   explanation scores criteria that the structured `perCriterion` array omits,
   so `processScore` is computed over fewer criteria than the rubric. The
   structured output should be validated against `rubric.items` and missing
   criteria surfaced (or the call retried).
3. **Empty answers can pass.** `outcomeSuccess` is set with `finalAnswer: ""`
   and `status: "error"`; the verifier should treat these as hard fails
   before consulting the rubric.
