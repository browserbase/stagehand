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

Use Node.js 24 or newer. Clone karpo-browser; the eval agent runs from the clone, with nothing to
install:

```bash
git clone https://github.com/machinepulse-ai/karpo-browser.git
```

Then export, in the shell you run evals from:

```bash
export EVAL_KARPO_BROWSER_PATH=/absolute/path/to/karpo-browser/evals/stagehand/agent.sh
export SYSTEM1_MODEL=... SYSTEM1_API_KEY=...   # System 1; SYSTEM1_URL if not on OpenRouter
export SYSTEM2_API_KEY=...                     # System 2: an OpenRouter key
export BROWSERBASE_API_KEY=... BROWSERBASE_PROJECT_ID=...
```

karpo-browser's README describes the System 1 models and System 2's settings.

## Run

From `packages/evals`:

```bash
evals doctor --harness karpo_browser
evals run b:hardbenchmark --harness karpo_browser -e browserbase
```

| Variable                         | Meaning                                     | Default                                                              |
| -------------------------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| `EVAL_KARPO_BROWSER_PATH`        | Absolute path of karpo-browser's eval agent | Required                                                             |
| `EVAL_KARPO_BROWSER_MAX_STEPS`   | Tool-call budget of a task                  | `AGENT_EVAL_MAX_STEPS`, then the dataset's (HardBench: 100), then 50 |
| `EVAL_KARPO_BROWSER_RUN_SECONDS` | Time limit of a task, in seconds            | 2400                                                                 |

Its rows count against the provider `karpo-browser` in `EVAL_PROVIDER_CONCURRENCY`.
