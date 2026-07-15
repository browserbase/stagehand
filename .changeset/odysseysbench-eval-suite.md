---
"@browserbasehq/stagehand-evals": minor
---

Add OdysseysBench as a supported agent benchmark in the evals CLI. OdysseysBench is a 200-task web-agent benchmark (45 easy / 46 medium / 109 hard); each task ships a weighted rubric that is baked into the verifier's `precomputed_rubric` format so process + outcome are scored against the published criteria. Run with `--eval-name agent/odysseysbench` (or the `external_agent_benchmarks` category); supports `EVAL_ODYSSEYSBENCH_LIMIT`, `EVAL_ODYSSEYSBENCH_SAMPLE`, `EVAL_ODYSSEYSBENCH_LEVEL`, and `EVAL_ODYSSEYSBENCH_IDS`.
