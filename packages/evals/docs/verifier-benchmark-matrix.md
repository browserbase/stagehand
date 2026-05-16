# Verifier Benchmark Matrix

Use this matrix before changing `STAGEHAND_EVALUATOR_BACKEND` defaults.
`STAGEHAND_EVALUATOR_BACKEND` selects the public evaluator backend; `VERIFIER_*`
flags tune the verifier internals once that backend is selected.

```bash
STAGEHAND_EVALUATOR_BACKEND=legacy
STAGEHAND_EVALUATOR_BACKEND=verifier VERIFIER_APPROACH=outcome-only
STAGEHAND_EVALUATOR_BACKEND=verifier VERIFIER_APPROACH=a
STAGEHAND_EVALUATOR_BACKEND=verifier VERIFIER_APPROACH=b
```

Use `VERIFIER_APPROACH=outcome-only` as the verifier default for benchmarks
without curated rubrics. Use approaches `a` and `b` when evaluating the rubric
pipeline itself or datasets with trusted precomputed rubrics.

For saved trajectories, run verifier approaches against the same agent outputs
so verifier quality is isolated from agent variance:

```bash
TRAJECTORY_GLOB=".trajectories/<run-prefix>*" scripts/cross-verify-parallel.sh
```

Optional environment:

```bash
EVALS_ENV_FILE=~/.envs/prod-evals.env
PARALLEL=8
VERIFIER_OPTIONAL_STEPS=folded
```

Report at least:

- accuracy against manually reviewed labels
- false positives and false negatives
- invalid or ambiguous task handling
- evidence-insufficient count
- latency and model cost

Do not flip the default backend until verifier results beat or match legacy on
the target datasets and failure analysis is reviewed.
