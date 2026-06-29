# Running evals against Stagehand v4 (v3 vs v4 comparison)

This lets us run the existing eval suites against the **v4** SDK and compare them
apples-to-apples with **v3**, to find where v4 regresses or differs.

## What's wired up

| Suite                           | v4                         | v3 baseline              | Notes             |
| ------------------------------- | -------------------------- | ------------------------ | ----------------- |
| CORE (18 deterministic, no-LLM) | `--tool stagehand_v4_code` | `--tool understudy_code` | model-agnostic    |
| bench `extract` (25)            | `EVAL_SDK=v4`              | (no env)                 | LLM, single model |
| bench `act` (40)                | `EVAL_SDK=v4`              | (no env)                 | LLM, single model |
| bench `observe` (12)            | `EVAL_SDK=v4`              | (no env)                 | LLM, single model |

Not yet supported on v4: other bench categories (`agent`, `combination`), and the
few iframe tasks (`page.frameLocator()`/`page.frames()`) — those fail with a clear
"not supported" message, not a real result.

## One-time setup

1. **Check out and build v4** next to this repo (default path `../stagehand-v4`):
   ```bash
   git clone git@github.com:browserbase/stagehand-v4.git ../stagehand-v4
   cd ../stagehand-v4 && pnpm install && <build the SDK + extension>   # see v4 repo README
   ```
   If your checkout is elsewhere: `export STAGEHAND_V4_DIR=/path/to/stagehand-v4`.
2. **API keys** in the repo-root `.env` (CORE needs none; bench needs one):
   ```
   ANTHROPIC_API_KEY=...
   OPENAI_API_KEY=...
   ```
3. `pnpm install` in this repo.

## Run everything (the easy button)

From the repo root:

```bash
pnpm --filter @browserbasehq/stagehand-evals run eval:v4
```

This (a) rebuilds the v4 shim from your current v4 checkout, (b) runs all four
suites on **both** v4 and v3, and (c) writes a report. Takes ~15–20 min
(one browser per task, concurrency 1 for stable numbers).

**Switch the model** (default is `anthropic/claude-sonnet-4-6`):

```bash
EVAL_MODEL=openai/gpt-4.1-mini pnpm --filter @browserbasehq/stagehand-evals run eval:v4
```

## Run one suite (faster iteration)

```bash
cd packages/evals
EVAL_SDK=v4 evals run extract -m anthropic/claude-sonnet-4-6 -c 1 -t 3   # v4
            evals run extract -m anthropic/claude-sonnet-4-6 -c 1 -t 3   # v3 baseline
# swap `extract` for `act` / `observe`; for CORE use:
evals run core --tool stagehand_v4_code   # v4
evals run core --tool understudy_code     # v3
```

## Reading the results

- **`packages/evals/ctrf/v4-findings.md`** — the report: a v4-vs-v3 pass-rate table
  per suite, plus a per-task "failing on v4" diff with a **failure column** and the
  v4 commit it ran against.
- **`packages/evals/ctrf/v4/*.json`** — raw per-suite snapshots. Each failed eval
  has a full `error` string (the report column is truncated; the JSON is complete).

When a task fails, check whether v3 passed it (the diff's v3 column): if v3 passes
and v4 fails, that's a v4 delta worth filing.

## How it works (short version)

- The v4 JS SDK is TypeScript-only, so `build:v4` esbuild-bundles it into
  `core/tools/vendor/stagehand-v4.js` and copies the matching browser-extension zip
  next to the CLI. (The committed `stagehand-v4.js` is a tiny stub; the real bundle
  is built locally and **git-ignored in spirit — don't commit it**, see below.)
- **CORE** runs through a tool surface (`stagehand_v4_code`) that implements the
  same contracts as the v3 understudy tool.
- **Bench** runs through a `V3`-shaped facade (`framework/v4BenchSdk.ts`) gated by
  `EVAL_SDK=v4`: it maps `act`/`extract`/`observe` + the `page`/`locator` calls the
  tasks use onto v4's SDK, so the task files run unchanged.

## Gotchas

- **Model must be provider-prefixed** — `openai/gpt-4.1-mini`, not `gpt-4.1-mini`
  (a bare name throws `UnsupportedModelError`).
- **v4 moves fast.** Re-pull v4 and re-run `eval:v4` (it rebuilds the shim each
  time). The report stamps the v4 commit, so always note which v4 SHA a number came
  from when sharing.
- **Before committing**, make sure `core/tools/vendor/stagehand-v4.js` is the small
  stub, not the multi-MB built bundle (`build:v4` overwrites it locally). Check with
  `head -1` — the stub starts with `// PLACEHOLDER`.
- **CORE on v4 may fail wholesale** if v4's launched Chrome can't reach the local
  `127.0.0.1` fixture server — that's a v4-side networking thing, not your setup
  (compare `core_v4` vs `core_v3` in the report).
- Bench is **single-model** per run; CORE ignores `-m` (it's deterministic/no-LLM).
