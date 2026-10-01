# Antigravity eval runner

Runs Google Antigravity's agent loop headlessly through the Python SDK
(`google-antigravity`) for `--harness antigravity`.

`runner/run_eval.py` reads one JSON request on stdin and writes JSONL events on
stdout using the Deep Agents runner protocol (`assistant`, `tool_call`,
`tool_result`, `final`, `usage`, `error`), so the evals framework reuses the Deep
Agents session driver, MCP tool mount and trajectory adapter.

- Antigravity keeps its native system prompt; the eval policy is appended as a
  section.
- The mounted MCP servers are the only tools that act, apart from the SDK's
  generic MCP helpers (`call_mcp_tool`, `list_resources`, `read_resource`).
- The Antigravity runtime replaces any tool output over about 4 KB with a notice
  pointing at a file under its app-data `brain` directory, and stores MCP tool
  schemas there too. This limit is not configurable, so the builtin `view_file`
  is the one builtin left enabled. A pre-tool hook denies any `view_file` path
  outside that directory. Without it the agent never sees a page snapshot.
- Each run gets its own temporary app-data directory, removed at exit. The runner
  reads the saved files to record full tool outputs and screenshots as evidence.
- The Antigravity runtime starts MCP servers with a reduced environment, so the
  runner forwards non-empty `STAGEHAND_*` and `BROWSERBASE_*` variables to them.
- Step budget: the runner counts every tool call except `view_file` reads and
  cancels the turn after N. A budget stop maps to `max_turns`.
- Usage: the SDK's `prompt_token_count` is net of cached tokens, so the runner
  reports input as prompt + cached (cached is a subset) and `candidates +
  thoughts` as output.

```sh
EVAL_HARDBENCHMARK_IDS=bestbuy_comparison_shopping_45 \
  node packages/evals/dist/cli/cli.js run b:hardbenchmark -e browserbase \
  --harness antigravity -m google/gemini-3.8-flash -t 1
```

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Gemini API key (`GOOGLE_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` also accepted). |
| `EVAL_ANTIGRAVITY_MAX_STEPS` | Tool-call budget (then `AGENT_EVAL_MAX_STEPS`, dataset default, 50). |
| `EVAL_ANTIGRAVITY_THINKING_LEVEL` | `minimal`, `low`, `medium`, `high` or `extra_high`. |
| `EVAL_ANTIGRAVITY_WALL_TIMEOUT_S` | Optional wall-clock limit for the agent turn. |
| `STAGEHAND_ANTIGRAVITY_RUNNER_DIR` | Override the runner project directory. |

Runner tests: `uv run --project packages/integrations/antigravity/runner --group dev pytest`.
