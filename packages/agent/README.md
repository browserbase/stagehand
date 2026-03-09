# `@browserbasehq/agent`

`packages/agent` is a higher-level coding agent that runs on top of Stagehand.

## Architecture

- `lib/agent.ts`
  Top-level `Agent` runtime. Owns conversation state, workspace state, tool routing, and the human-facing `send()` / `stream()` API.
- `lib/subagent.ts`
  Browser-owning subagent runtime. Each subagent owns exactly one local `Stagehand` session, one Stagehand agent instance, one queue, and one workspace subfolder.
- `lib/workspace.ts`
  Workspace bootstrap and TODO/log/screenshot/download directory management.
- `lib/execSessions.ts`
  Bash session manager backing `functions.exec_command` and `functions.write_stdin`.
- `lib/schemas.ts`
  Zod v4 schemas for serializable tool calls and results.

## Runtime model

- The top-level agent never calls browser APIs directly.
- Browser state lives behind subagent tool calls keyed by `browser_id`.
- `web.spawn_agent(...)` appends a task to `workspace/subagentN/TODO.md`, runs it through that subagent's Stagehand agent queue, and returns the subagent result.
- All tool calls are modeled as discrete request/response objects so the package can later be moved behind a transport without redesigning the API.
