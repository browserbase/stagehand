# Antigravity eval runner

Runs Google Antigravity's agent loop headlessly through the Python SDK
(`google-antigravity`) for `--harness antigravity`.

- `src/` is the session adapter evals imports
  (`@browserbasehq/stagehand-integrations-antigravity`): runner location, Gemini model
  normalization, the facade system prompt section, and `runAntigravitySession`.
- `runner/` is the uv project the adapter spawns. `run_eval.py` reads one JSON request
  on stdin and writes JSONL events on stdout using the Deep Agents runner protocol
  (`assistant`, `tool_call`, `tool_result`, `final`, `usage`, `error`), so the adapter
  reuses the Deep Agents process driver and evals reuses its MCP tool mount and
  trajectory adapter.

Behavior:

- Antigravity keeps its native system prompt; the eval policy is appended as a
  section.
- Browser actions go only through the mounted MCP servers (plus the SDK's generic
  MCP helpers `call_mcp_tool`, `list_resources`, `read_resource`). The one builtin
  left on is `view_file`, which only reads the runtime's saved outputs (below).
- The Antigravity runtime replaces any tool output over about 4 KB with a notice
  pointing at a file under its app-data `brain` directory, and stores MCP tool
  schemas there too. This limit is not configurable, so the builtin `view_file`
  is the one builtin left enabled. A pre-tool hook denies any `view_file` path
  outside that directory. Without it the agent never sees a page snapshot.
- Each run gets its own temporary app-data directory, removed at exit. The runner
  reads the saved files to record full tool outputs and screenshots as evidence.
- The Antigravity runtime starts MCP servers with a reduced environment, so the
  runner forwards non-empty `STAGEHAND_*` and `BROWSERBASE_*` variables to them.
  The SDK has no per-server working directory, so a server with a `cwd` is
  launched through a small Python shim that changes into it first.
- Step budget: the runner counts every tool call except `view_file` reads and
  cancels the turn after N. A budget stop maps to `max_turns`.
- Usage: the SDK's `prompt_token_count` is net of cached tokens, so the runner
  reports input as prompt + cached (cached is a subset) and `candidates +
  thoughts` as output.
- The agent answers with the `EVAL_RESULT:` line; the runner has no structured
  output mode, so `EVAL_RESULT_CONTRACT=structured_output` fails the run before a
  browser session starts.

## Run

Requires [uv](https://docs.astral.sh/uv/), a Gemini API key, and Browserbase
credentials for `-e browserbase`:

```sh
export GOOGLE_GENERATIVE_AI_API_KEY=...
export BROWSERBASE_API_KEY=bb_live_...
export BROWSERBASE_PROJECT_ID=...   # optional
pnpm exec turbo run build --filter @browserbasehq/stagehand-evals
EVAL_HARDBENCHMARK_IDS=a0a18ca6a3529f3e97c771aadd42d3a0 \
  node packages/evals/dist/cli/cli.js run b:hardbenchmark -e browserbase \
  --harness antigravity -m google/gemini-3.8-flash -t 1
```

| Variable                           | Purpose                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `GOOGLE_GENERATIVE_AI_API_KEY`     | Gemini API key; then `GEMINI_API_KEY`, then `GOOGLE_API_KEY` (the facade's order). |
| `BROWSERBASE_API_KEY`              | Browserbase credential for the browser session (required for `-e browserbase`).    |
| `BROWSERBASE_PROJECT_ID`           | Optional Browserbase project.                                                      |
| `EVAL_ANTIGRAVITY_MAX_STEPS`       | Tool-call budget (then `AGENT_EVAL_MAX_STEPS`, dataset default, 50).               |
| `EVAL_ANTIGRAVITY_THINKING_LEVEL`  | `minimal`, `low`, `medium`, `high` or `extra_high`.                                |
| `EVAL_ANTIGRAVITY_WALL_TIMEOUT_S`  | Optional wall-clock limit for the agent turn.                                      |
| `STAGEHAND_ANTIGRAVITY_RUNNER_DIR` | Override the runner project directory.                                             |

## Tests

```sh
pnpm --filter @browserbasehq/stagehand-integrations-antigravity test
cd packages/integrations/antigravity/runner && uv sync --locked && uv run --locked pytest
```
