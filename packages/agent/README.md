# `@browserbasehq/agent`

`packages/agent` is now a thin orchestration layer on top of the `browse` CLI.

## Design

- `packages/cli` owns all live browser and Stagehand behavior.
- `packages/agent` does not create or cache Stagehand instances.
- Top-level browser work is done by running `browse` from `PATH`, usually through `functions_exec_command`.
- `packages/agent` keeps only orchestration state, shell/process helpers, plan/document helpers, and background `browse subagent` management.

## Main Files

- `lib/agent.ts`
  Top-level planner/runtime that streams model output and dispatches `ALL_TOOLS`.
- `lib/browseCli.ts`
  Small internal bridge for invoking the installed `browse` CLI.
- `lib/state/session.ts`
  Workspace helpers for `TODO.md`, top-level config/log files, and per-subagent config files.
- `lib/state/agents.ts`
  Background-agent helper that runs `browse subagent` in a child process and tracks its status on disk.
- `lib/state/process.ts`
  Shell session owner for `functions_exec_command` / `functions_write_stdin`.
- `lib/tools/`
  Flat tool folder for non-browser function tools only.

## Browser Flow

Use one direct CLI path for top-level browser work:

```bash
browse --json open https://example.com
browse --json act "click the sign in button"
browse --json observe
browse --json extract --schema '{"type":"object","properties":{"title":{"type":"string"}}}'

# Use another browser slot when needed
browse --json --session browser-2 open https://example.com
```

The CLI owns the live browser session under `/tmp/browse-<session>...`.

For AI-powered browse commands, `packages/agent` injects:
- `BROWSE_MODEL=<workspace llm model>`
- `BROWSE_EXECUTION_MODEL=<workspace llm model>`

So the top-level agent does not need to spend context repeating `--model ...` on every command.

There is also one delegated path for background browser work:
- `functions_spawn_agent` -> `browse subagent`
- that child uses its built-in browser tool surface directly
- it should not shell out to `browse` again
