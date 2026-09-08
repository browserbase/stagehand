# HardBench

HardBench contains 102 browser tasks with precomputed rubrics. Each JSONL row
contains its task ID, question, optional starting URL, tier, and rubric metadata.
The row's `set` field determines tier membership.

| Tier       | Tasks | Selection                              |
| ---------- | ----: | -------------------------------------- |
| `core`     |    38 | Default                                |
| `extended` |    64 | Selects these plus core, for 102 tasks |

Run `b:hardbenchmark` with the eval CLI and an external harness. Configure selection
with these environment variables:

- `EVAL_HARDBENCHMARK_SET`: `core` or `extended`.
- `EVAL_MAX_K` or `EVAL_HARDBENCHMARK_LIMIT`: positive task cap; `EVAL_MAX_K`
  takes precedence. CLI `-l N` sets the benchmark limit.
- `EVAL_HARDBENCHMARK_SAMPLE`: random sample size, bounded by that cap.
- `EVAL_HARDBENCHMARK_IDS`: comma-separated task IDs or slugs in requested order.
  Explicit selections override tier, sampling, and cap.
  Unknown or duplicate selections are errors.

[Rubric v1.2 clarifications](RUBRIC-CLARIFICATIONS.md) define table formatting,
fallbacks, transaction boundaries, source authority, relative dates, and one
task-specific deliverable rule. The existing V3 verifier consumes these rules as
criterion text. Tasks without an applicable clarification retain their original
rubric. A permitted fallback waives only the requirement named by that criterion.

For offline authoring checks, run
`node --import tsx packages/evals/scripts/audit-hardbenchmark.ts --dataset <jsonl> --out <new-report.json>`.
This reports rubric defects and stop-boundary ambiguities without modifying tasks.
`python3 packages/evals/scripts/audit/rubric-clarify.py --dataset <jsonl> --out <new-jsonl>`
applies conventions to a separate output; `--overwrite` permits replacing an
existing output, never the source dataset. Optional `--overrides <json>` writes
an ID-to-rubric mapping. Review any newly added conventions before changing the corpus.

The compatibility fixtures are a separate, bounded verifier test set. Run the
offline gate against the desired checkout:

```sh
node --import tsx packages/evals/scripts/verify-hardbenchmark-compatibility.ts \
  --repo . \
  --dataset packages/evals/datasets/hardbenchmark/HardBenchmark_data.jsonl \
  --fixtures packages/evals/tests/fixtures/hardbenchmark-compatibility/manifest.json \
  --out /tmp/hardbench-compat-offline
```

It exercises the installed V3 evaluator and grading adapter with mocked provider
HTTP responses, including rejected provider/schema failures. No browser or model
request runs. For the twelve-case live semantic check, use a new output directory
and add `--live --judge-model google/gemini-2.5-flash` with credentials already in
the environment. The gate loads no `.env` file. It preserves declared outcome and
process expectations and records sanitized request evidence and results. This
checks rubric compatibility; it does not run benchmark agents or establish model scores.
