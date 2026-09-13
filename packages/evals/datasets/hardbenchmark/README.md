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
