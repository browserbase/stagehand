# Hermes × Stagehand verifier pilot

This adapter runs Hermes's own agent loop against the unchanged public dataset
rows and verifier path in `@browserbasehq/stagehand-evals`.

The frozen pilot is `pilots/hermes-online-mind2web-hard-v1.json`: ten official
Online-Mind2Web `hard` tasks curated before scoring across ten distinct public
sites. The slice favors high reference lengths while excluding login, payment,
irreversible, expired fixed-date, and relative-date tasks. The selection is
validated by `tests/framework/hermesPilot.test.ts`; it is not the first ten
rows or a post-result sample.

## Arms

- `--harness hermes --tool hermes_browser_legacy`: Hermes's twelve-tool
  `browser_*` surface.
- `--harness hermes --tool hermes_browser_exec`: Hermes's one-tool Browser Use
  `browser_exec` surface.
- `--harness hermes --tool hermes_stagehand_batch`: Hermes's one-tool
  `browser_exec` surface backed by Stagehand V4 `experimental_batch`.

All three arms use Hermes `--provider ai-gateway`, the exact model ID supplied by
`--model`, the same Browserbase environment, the same task row, and the same
Stagehand verifier. The verifier model is independently configured through
`EVAL_VERIFIER_MODEL=gateway/google/gemini-2.5-flash` and uses
`AI_GATEWAY_API_KEY`. A trajectory passes only when `outcome=true` and
`process_score>=0.8`; the commands therefore use `--success both`.

The Hermes child environment is allowlisted to the Gateway and Browserbase
credentials plus runtime/networking variables. Unrelated service tokens are
excluded so they cannot change capability discovery, tool schemas, or reach a
model-driven subprocess.

The methodology-target verifier, `gateway/openai/o4-mini`, was exercised
through Vercel AI Gateway before the pilot. Its real rubric-generation request
failed with `GatewayInternalServerError: The API deployment for this resource
does not exist.` No browser or agent retry was made. The frozen fallback is
`gateway/google/gemini-2.5-flash`, which successfully generated the same task's
rubric through the Gateway. This provider substitution must be reported with
the benchmark results.

Set one durable `EVAL_RUBRIC_CACHE_ROOT` for the entire experiment. The first
successful verifier pass generates one rubric per task and stores it under the
task ID plus instruction hash; every later arm reads that exact cached rubric.
Do not clear or change this directory between arms.

The Stagehand arm imports the Python SDK from a clean checkout pinned at commit
`4186c7d98d2f325b6fc85b3f760111e6c390d703`. It defaults to
`/workspace/stagehand-v4-tip-4186`; `EVAL_STAGEHAND_V4_ROOT` may point to an
equivalent clean checkout, but the adapter verifies the exact commit before a
run and refuses a dirty or mismatched tree.

Hermes's opt-in benchmark instrumentation captures URL and screenshot evidence
after successful browser calls. The adapter attaches these frames to the
corresponding Stagehand `TrajectoryStep`, retains the final observation, and
preserves Hermes tool arguments/results, reasoning, final answer, and usage.

## Preview without model or browser spend

```bash
OPUS_IDS=$(node -p "require('./packages/evals/pilots/hermes-online-mind2web-hard-v1.json').task_model_pairs.filter(x=>x.model.includes('opus')).map(x=>x.task_id).join(',')")
pnpm --filter @browserbasehq/stagehand-evals eval run b:onlineMind2Web \
  --harness hermes --tool hermes_browser_exec --env browserbase \
  --model anthropic/claude-opus-4.8 --trials 1 --concurrency 1 \
  --filter "ids=$OPUS_IDS" --preview
```

## Scored pilot

Set these through managed environment injection, never in repository files:

- `AI_GATEWAY_API_KEY`
- `BROWSERBASE_API_KEY`
- `BROWSERBASE_PROJECT_ID` is optional when the API key can see exactly one
  project; the runner discovers that project for its child process without
  logging or persisting the ID. Set it explicitly when the key sees more than
  one project.

The manifest-driven runner enforces the task/model pairing, task-level
counterbalanced arm order, 30-minute timeout, source hash, source/runtime pins,
and resumable row identities. Previewing prints the exact rows and creates no
browser sessions or model calls:

```bash
export EVAL_HERMES_ROOT=/workspace/hermes-stagehand-batch
export EVAL_STAGEHAND_V4_ROOT=/workspace/stagehand-v4-tip-4186
export EVAL_VERIFIER_MODEL=gateway/google/gemini-2.5-flash
export EVAL_RUBRIC_CACHE_ROOT=/workspace/stagehand-public-pilot-rubric-cache
export EVAL_MAX_UNVERIFIABLE_CRITERIA=0
pnpm --filter @browserbasehq/stagehand-evals benchmark:hermes-public-hard \
  --phase canary --dry-run

pnpm --filter @browserbasehq/stagehand-evals benchmark:hermes-public-hard \
  --phase full --dry-run

pnpm --filter @browserbasehq/stagehand-evals benchmark:hermes-public-hard \
  --phase canary --confirm-billable --output /workspace/stagehand-evals-public-hard-canary

pnpm --filter @browserbasehq/stagehand-evals benchmark:hermes-public-hard \
  --phase full --confirm-billable --output /workspace/stagehand-evals-public-hard-full \
  --canary-root /workspace/stagehand-evals-public-hard-canary
```

For raw Hermes audit artifacts, set `EVAL_HERMES_ARTIFACT_ROOT` to a directory
outside the repository. When unset, raw subprocess state is removed after the
normalized trajectory is built; the normal Stagehand trajectory artifact is
still persisted.

## Recover a retained artifact with a verifier sidecar

If a runner record is `status: "error"` but its retained Hermes artifact is
complete and independently evidenced, rerun only the Stagehand verifier. This
is a billable verifier request, but it does not relaunch Hermes or a browser:

```bash
pnpm --filter @browserbasehq/stagehand-evals regrade:hermes -- \
  --artifact /workspace/stagehand-public-pilot-hermes-artifacts/<run> \
  --task-id <frozen-task-id> \
  --surface hermes_browser_exec \
  --trajectory-root /workspace/stagehand-public-pilot-regrade \
  --result-json /workspace/stagehand-evals-public-hard-full/<run>/verifier-result.json
```

Choose the surface that matches the immutable raw record:
`hermes_browser_legacy`, `hermes_browser_exec`, or
`hermes_stagehand_batch`. Keep the same durable rubric cache and frozen
`EVAL_VERIFIER_MODEL` used by the matrix.

`record.json` remains immutable. The runner and reporting layer accept the
adjacent `verifier-result.json` only when its schema version, task, surface,
verifier model, criterion count, evidence-insufficient count, score, outcome,
and retained trajectory directory are all valid. For the frozen `both` success
mode, a pass requires `outcome=true`, `process_score>=0.8`, and zero
evidence-insufficient criteria. A valid failed verdict remains a failed grade;
a missing, malformed, or identity-mismatched sidecar fails closed. Reports
retain the raw error status and count the sidecar as an effective regrade
instead of rewriting the original record.

## Final report handoff

Keep canary/full roots, raw Hermes artifacts, trajectories, rubric caches, and
runner logs outside this repository. After the full 30-record schedule stops:

1. preserve the output root byte-for-byte;
2. resolve any eligible retained-artifact regrades into adjacent sidecars;
3. retain the original summary as historical runner output—the strict report
   resolves raw records and sidecars independently; and
4. hand the unchanged Stagehand evals root to the benchmark repository's
   `benchmarks.public_hard.matched_analysis` command alongside the completed
   Hermes-native root.

The publishable bundle belongs in the benchmark repository under `reports/`,
not in `packages/evals/artifacts/`. It should contain only the strict
machine-readable analysis, Markdown/HTML rendering, runtime provenance,
scheduled-record hashes, and methodology log. Do not publish screenshots,
DOMs, browser profiles, state databases, raw trajectories, credentials, or
transient partial-run summaries.
