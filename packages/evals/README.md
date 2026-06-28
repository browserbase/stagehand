# Stagehand Evals

Agent benchmarks for Stagehand — `act`, `extract`, `observe`, `agent`, `combination`, plus dataset-backed suites (WebVoyager, OnlineMind2Web, WebTailBench, GAIA).

Driven by an interactive TUI (`evals`) or single-shot CLI (`evals run …`). Tasks are auto-discovered from `tasks/bench/<category>/` — no registration step.


## Quickstart

From the stagehand repo root:

```bash
pnpm install
pnpm build:cli   # also: pnpm build, if you haven't built the workspace yet
```

This links an `evals` binary on your `PATH`. Launch the REPL:

```bash
evals
```

![REPL with help output](./assets/readme/help.png)

Or run a single target:

```bash
evals run extract -t 3 -c 5
evals run b:webvoyager -l 10
```

A `.env` in `packages/evals/` is loaded automatically. Provide whichever provider keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, …) and `BROWSERBASE_API_KEY` / `BROWSERBASE_PROJECT_ID` you need.

## TUI commands

Inside the REPL (or as `evals <command>` from your shell):

| Command | What it does |
| --- | --- |
| `run [target] [options]` | Run evals. Target can be a tier, category, task, or benchmark shorthand. |
| `list [tier] [--detailed]` | List discovered tasks and categories. |
| `new <tier> <category> <name>` | Scaffold a new task file. |
| `config [set\|reset\|path]` | Read or write defaults (env, trials, concurrency, model, …). |
| `experiments` | Inspect and compare Braintrust experiment runs. |
| `help` | Show command help. Append `--help` to any command for details. |

Use `Esc` to abort an in-flight run without exiting the REPL.

## Run targets

`evals run` accepts any of these shapes:

| Target | Meaning |
| --- | --- |
| _(none)_ / `all` | All bench tasks |
| `bench` | Entire bench tier |
| `act` / `extract` / `observe` / `agent` / `combination` | A category |
| `extract/extract_text` | A specific task |
| `b:webvoyager` / `b:onlineMind2Web` / `b:webtailbench` | Dataset-backed benchmark suite |

`evals list` shows everything that's been discovered:

![evals list output](./assets/readme/list.png)

## Common options

| Flag | Purpose |
| --- | --- |
| `-e, --env <local\|browserbase>` | Where the browser runs |
| `-t, --trials <n>` | Trials per task |
| `-c, --concurrency <n>` | Max parallel sessions |
| `-m, --model <id>` / `-p, --provider <name>` | Override the model/provider matrix |
| `--api` | Run via the Stagehand API instead of the SDK |
| `--harness <stagehand\|claude_code\|codex>` | Which agent harness drives the bench task |
| `--agent-mode <dom\|hybrid\|cua>` / `--agent-modes <csv>` | Stagehand agent mode (or matrix) |
| `-l, --limit <n>` / `-s, --sample <n>` / `-f, --filter key=value` | Suite shaping for benchmark targets |
| `--preview` | Print the resolved plan and exit — no browser, no LLM calls |

Defaults live in `evals.config.json` and can be edited via `evals config set …`.

`--preview` is useful for sanity-checking the plan before paying for a run:

![evals run --preview output](./assets/readme/preview.png)

A live run paints an in-place progress table, then prints a final summary with a per-model breakdown:

![Live bench run](./assets/readme/run.gif)

## Running CORE evals against Stagehand v4

The CORE tier can run against the **v4** JS SDK (`stagehand-v4`) via the
`stagehand_v4_code` tool surface — a drop-in adapter that implements the same
tool contracts as `understudy_code`, so all 18 CORE tasks run unchanged.

v4 ships TypeScript source only and depends on its own workspace packages, so it
can't be imported directly by the built CLI. A one-time build step esbuild-bundles
it into `core/tools/vendor/stagehand-v4.js`:

```bash
# Requires a stagehand-v4 checkout at ../stagehand-v4 (with deps installed),
# or set STAGEHAND_V4_DIR=/path/to/stagehand-v4
pnpm --filter @browserbasehq/stagehand-evals run build:v4   # builds the shim, then rebuilds the CLI

evals run core --tool stagehand_v4_code
```

`build:v4shim` rebuilds only the bundle; `build:v4` also rebuilds the CLI so it
picks up the new bundle. Rerun it whenever the v4 SDK changes. Until it runs, the
`stagehand_v4_code` surface throws a clear "shim not built" error (the committed
`stagehand-v4.js` is a placeholder so the normal evals build works without the v4
repo present).

### Bench `extract`, `act`, and `observe` against v4

Bench tasks in the `extract`, `act`, and `observe` categories can also run against
v4, via a `V3`-shaped facade (`framework/v4BenchSdk.ts`) gated by `EVAL_SDK=v4`:

```bash
EVAL_SDK=v4 evals run extract -m anthropic/claude-sonnet-4-6 -c 1 -t 3
EVAL_SDK=v4 evals run act     -m anthropic/claude-sonnet-4-6 -c 1 -t 3
EVAL_SDK=v4 evals run observe -m anthropic/claude-sonnet-4-6 -c 1 -t 3
```

Or run CORE + extract + act + observe on both v4 and v3 and get an apples-to-apples report
in `ctrf/v4-findings.md`:

```bash
pnpm --filter @browserbasehq/stagehand-evals run eval:v4
```

Notes:

- Local only for now (`tool_launch_local`) — v4 launches its own Chrome +
  extension; `--env browserbase` isn't wired up yet.
- CORE adapter polyfills `title` / `waitForSelector` / locator
  `count`/`isVisible`/`textContent`/`inputValue` via `page.evaluate` (v4 has no
  dedicated methods).
- The bench facade is single-model and covers `extract` + `act` + `observe`
  only; other categories error under `EVAL_SDK=v4`. It does not yet implement
  `page.frameLocator()` / `page.frames()`, so the few iframe-based tasks fail with
  a clear "not supported" message.

## Adding a bench task

```bash
evals new bench extract my_new_task
```

This drops a `defineBenchTask`-based file into `tasks/bench/extract/`. It will show up in `evals list` on next launch — no config edit needed.

```ts
// tasks/bench/extract/my_new_task.ts
import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask({
  name: "my_new_task",
  tags: ["regression"],
  run: async ({ stagehand, logger }) => {
    // ... drive stagehand, return { _success: boolean, ... }
  },
});
```

## Tracing / Observability

Runs stream into Braintrust when `BRAINTRUST_API_KEY` is set; otherwise a local summary prints to stdout. Use `evals experiments` to inspect and diff past Braintrust runs.
