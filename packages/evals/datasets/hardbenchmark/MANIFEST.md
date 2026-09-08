# HardBench corpus and rubric v1.2

HardBench combines selected WebTailBench/Online-Mind2Web tasks with authored
compositional tasks (dependent goals across sites) and adversarial tasks
(detail-page constraints, conflicting sources, unavailable items and stop boundaries).
The corpus contains 158 unique rows; all have precomputed rubrics. Questions,
IDs, set membership and validity are fixed by this import. Rubric v1.2 clarifies
149 rows; the other nine rubrics required none of these conventions.

| Row set     | Rows | Selection                                         |
| ----------- | ---: | ------------------------------------------------- |
| core        |   38 | Default                                           |
| extended    |   64 | `extended` selects these **plus core**, total 102 |
| holdout     |   20 | Explicit `holdout` or explicit task ID/slug only  |
| retired     |   33 | Never selected (`valid: false`)                   |
| quarantined |    3 | Never selected (`valid: false`)                   |

`all` selects 102 valid non-holdout rows. It does not select all 158 rows.
The default core comprises 19 selected original tasks, 15 authored pilots and
four promoted variants. Families/parent IDs and historical authoring checks are
preserved in the data and `manifest.json`; those checks do not establish current
site availability. Retirements cover saturated tasks and task/rubric defects;
quarantine is distinct from an agent's capability failure. Preserve inactive
rows and their reasons instead of deleting them.

The exact corpus SHA-256 is
`2eca8e697d40c7d3f4179af3aea3a4aa620843a6bc55ba9fcbd088592668ce5a`.
`manifest.json` records the hash and every set's task IDs. The corpus version is
1.1; the independent rubric policy version is 1.2.

## Run selection

After building the eval CLI, use `evals run b:hardbenchmark --harness <harness>`.
The suite uses the same registered external-harness path as the other agent
benchmarks. This import leaves main's evaluator, harness prompts and step
budgets unchanged. It does not reproduce historical campaign settings or scores.

| Setting                                   | Behavior                                                                                                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EVAL_HARDBENCHMARK_SET`                  | `core` (default), `extended`, `holdout`, `all`                                                                                                                               |
| `EVAL_MAX_K` / `EVAL_HARDBENCHMARK_LIMIT` | Positive integer cap; `EVAL_MAX_K` takes precedence. Default is the whole selected set. CLI `-l N` sets the benchmark limit.                                                 |
| `EVAL_HARDBENCHMARK_SAMPLE`               | Optional random sample size, bounded by the cap; record selected IDs for reproducibility.                                                                                    |
| `EVAL_HARDBENCHMARK_MODE`                 | Filter the selected set by the original `failure_mode`.                                                                                                                      |
| `EVAL_HARDBENCHMARK_IDS`                  | Comma-separated IDs/slugs in requested order; overrides set, mode, sampling and cap. May explicitly select holdout. Unknown, inactive and duplicate resolved IDs are errors. |
| `EVAL_HARDBENCHMARK_VERBOSE=1`            | List skipped inactive rows.                                                                                                                                                  |

Some rows have no start URL; their task text drives navigation from Google.
The original question is passed unchanged, and the normalized precomputed rubric
is passed through the existing V3 verifier adapter. Rubric version, applied
clarifications, original suite, capability, family and set metadata accompany
results. A missing `rubric_version` on the nine untouched rows is intentional.

## Rubric policy and verification

[RUBRIC-CLARIFICATIONS.md](RUBRIC-CLARIFICATIONS.md) defines the six conventions.
They are criterion text consumed by the pinned `stagehand-v3@3.7.1` verifier;
this import adds no extracted evaluator, replay tool, classifier or relabeler.
A rubric-sanctioned fallback waives only the named requirement. All other task
constraints remain binding. A site blocker can earn process credit without
completing the outcome; it is not an automatically recovered pass.

The [compatibility gate](../../scripts/verify-hardbenchmark-compatibility.ts)
accepts explicit repo, dataset, fixture and output paths, so the same gate can
run against an untouched main checkout and a checkout containing this import:

```sh
node --import tsx packages/evals/scripts/verify-hardbenchmark-compatibility.ts \
  --repo . \
  --dataset packages/evals/datasets/hardbenchmark/HardBenchmark_data.jsonl \
  --fixtures packages/evals/tests/fixtures/hardbenchmark-compatibility/manifest.json \
  --out /tmp/hardbench-compat-offline
```

Offline mode calls the real V3 evaluator, rubric verifier and grading adapter.
Only provider HTTP transport is substituted; all outgoing fetches are intercepted.
It checks a full real v1.2 rubric, opposing self-reports, point arithmetic,
criterion identity, exact prompt rubric text and persisted results. Injected
provider/schema failures must be **rejected**. A passing test of fault rejection
is never counted as an accepted verification case.

For the bounded live gate, add `--live --judge-model google/gemini-2.5-flash` and
use a new output directory. This is the pinned V3 evaluator's production default,
selected independently of gate results. Set `GEMINI_API_KEY` in the calling
environment (`GOOGLE_GENERATIVE_AI_API_KEY` and `GOOGLE_API_KEY` are also
recognized); no `.env` file is loaded or borrowed. The checked-in manifest freezes six positive/
negative convention pairs using real criterion slices and synthetic recorded
pages. This is a semantic compatibility slice, not twelve full benchmark tasks.
No agent rollout, browser session, rubric generation or leaderboard update occurs.
Each fixture declares an independent process-score interval and rationale.
Full process credit is allowed with a false outcome for the CAPTCHA case and
for the park case whose selected criterion only assesses identifying parks and
costs. The other negative slices violate their selected criterion and must lose
some process credit. Positive slices must receive positive process credit; this
gate does not calibrate exact partial-point awards. Outcome expectations remain
fixed for all twelve cases.

The selected judge, process policies and input/source hashes are recorded in
`gate.json`. Live fetch pass-through saves versioned, sanitized request bodies
in `requests/` before sending each request, and aggregates them in `requests.json`.
Capture excludes headers and URL queries, redacts credential fields and the active
judge key, and permits only known Google, OpenAI and Anthropic generation endpoints
and verifier schemas. It forwards the original request body and abort signal.
It never generates a rubric. Prior `openai/gpt-4.1-mini` live results used a gate-only
judge and do not establish production-default compatibility.

For a repeated comparison, freeze all checkout/input hashes first and run three
complete twelve-case repetitions per checkout, preserving case order. Report all
cases and all suite results, including transport failures; do not select the best
repeat or change fixtures after seeing results. Three checkouts require 108 cases.
This is a bounded consistency check, not a statistical estimate of evaluator accuracy.
Inspect every case; provider/schema failures, incomplete scores and any
`verifierError` fail acceptance before `_success` is considered. The existing
adapter can retain self-report on verifier errors; the gate explicitly rejects
that path. Live checks require independent execution and are not established by
a green offline test.

## Authoring checks

`node --import tsx packages/evals/scripts/audit-hardbenchmark.ts --dataset <jsonl>
--out <new-report.json>` runs offline rubric/stop-boundary checks without credentials.
`--apply` explicitly flags rubric defects and stop-boundary review hints in the
input; it never reactivates inactive rows or replaces manual retirement reasons.
Stop-boundary hints are advisory, not automatic task invalidation. Current site
reachability and saved-run achievability probes are deferred; campaign-specific
site lists and audit corrections are not part of this import.

`python3 packages/evals/scripts/audit/rubric-clarify.py --dataset <jsonl>
--out <new-jsonl>` applies the idempotent v1.2 text transform. It preserves
questions and all nonrubric metadata, and requires `--overwrite` for existing
outputs. Optional `--overrides <new-json>` emits a task-ID/rubric map.
