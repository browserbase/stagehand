# karpo-browser

`src/` is the session adapter `packages/evals` imports for `--harness karpo_browser`. The
harness runs [karpo-browser](https://github.com/machinepulse-ai/karpo-browser), a browser agent in
which a chat model (System 2) plans the task and a decision model (System 1) picks each step on the
page.

## How it runs

For each task the harness starts karpo-browser's eval agent, which speaks the Deep Agents runner
protocol: the task as one JSON object on stdin, then one JSON event per stdout line. The agent
calls the `stagehand_facade` mount once, then drives the row's Browserbase session over its own CDP
connection, using the session id the harness passes in `BROWSERBASE_SESSION_ID`. Each step it takes
on the page is reported as a tool call: the runner records the page after it, and it counts against
the tool-call budget, which the agent enforces. The harness therefore runs on Browserbase only
(`-e browserbase`).

The model shown for its rows, `karpo-browser/controller`, is a label: the agent reads its models
from its own environment and reports no token usage to the runner. Its execution records, System
2's token counts among them, are kept in the trajectory's `agent/` directory.

## Setup

Build the eval CLI with Node.js 24 using the [evals quickstart](../../evals/README.md#quickstart).
In the same shell, install the published agent and export the absolute path to its executable.

```bash
karpo_dir="$(mktemp -d)"
(cd "$karpo_dir" && npm install @machinepulse_ai/karpo-browser@0.1.0)
export EVAL_KARPO_BROWSER_PATH="$karpo_dir/node_modules/.bin/karpo-browser-stagehand"
```

The following configuration uses the Karpo router for System 1 and OpenRouter for both
System 2 and the HardBench verifier. Set `SYSTEM1_API_KEY`, `OPENROUTER_API_KEY`,
`BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID` in your shell first.

```bash
export SYSTEM1_MODEL=karpo-decision-27b-act
export SYSTEM1_URL=https://router.karpo.ai/v1/systemone
export SYSTEM2_API_KEY="$OPENROUTER_API_KEY"
export EVAL_VERIFIER_MODEL=openai/google/gemini-3.5-flash
export OPENAI_BASE_URL=https://openrouter.ai/api/v1
export OPENAI_API_KEY="$OPENROUTER_API_KEY"
```

For development against a karpo-browser checkout, point `EVAL_KARPO_BROWSER_PATH` to the absolute
path of its `evals/stagehand/agent.sh`.

## Run

From `packages/evals`, check the harness and run one trial for each of the 38 HardBench Core tasks.

```bash
./bin/evals doctor --harness karpo_browser
EVAL_HARDBENCHMARK_SET=core EVAL_MAX_K=38 \
  ./bin/evals run b:hardbenchmark --harness karpo_browser -e browserbase -t 1
```

| Variable                         | Meaning                                     | Default                                                              |
| -------------------------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| `EVAL_KARPO_BROWSER_PATH`        | Absolute path of karpo-browser's eval agent | Required                                                             |
| `EVAL_KARPO_BROWSER_MAX_STEPS`   | Tool-call budget of a task                  | `AGENT_EVAL_MAX_STEPS`, then the dataset's (HardBench: 100), then 50 |
| `EVAL_KARPO_BROWSER_RUN_SECONDS` | Time limit of a task, in seconds            | 2400                                                                 |

Its rows count against the provider `karpo-browser` in `EVAL_PROVIDER_CONCURRENCY`.
