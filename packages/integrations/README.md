# Stagehand integrations

Agent-harness integrations for the Stagehand facade tool surface: three tools — `run`,
`snapshot`, and `screenshot` — backed by one persistent browser, consumable either as a stdio
MCP server or as native in-process tools. The contract (tool descriptions, schemas, runtime
validators, and the agent system prompt) is defined once in `core/` and imported everywhere
else, never restated.

## Structure

| Directory         | What it is                                                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/`           | The `@browserbasehq/stagehand-integrations` package: the facade contract, `StagehandFacadeTools`, the `stagehand-facade` stdio MCP bin, and the code-mode MCP host scaffold. |
| `claude-code/`    | Claude Agent SDK example (programmatic MCP mount) plus a `.mcp.json` for connecting a running Claude Code CLI.                                                               |
| `codex/`          | Codex SDK example (config-override MCP mount) plus a `config.toml` template for the codex CLI.                                                                               |
| `cursor/`         | Cursor agent CLI configuration template (`.cursor/mcp.json`) and AGENTS.md guidance — the CLI consumes the facade as a project MCP server.                                   |
| `crewai/`         | Python CrewAI example over MCP/stdio (uv project).                                                                                                                           |
| `deepagents/`     | Python LangChain Deep Agents integrations: a local stdio MCP server and a Managed Deep Agents project with native tools.                                                     |
| `eve/`            | Eve example with the tools bound natively via `defineTool` (Eve has no external-process tool mounting).                                                                      |
| `fx/`             | fx configuration templates and skill — fx consumes the facade via its user-global MCP config.                                                                                |
| `grok-build/`     | Grok Build CLI configuration template and AGENTS.md guidance. The CLI consumes the facade as a project MCP server.                                                           |
| `grok-build-sdk/` | Grok Build CLI session adapter used by evals.                                                                                                                                |
| `mastra/`         | Mastra example over MCP/stdio via Mastra's `MCPClient`.                                                                                                                      |
| `pi/`             | Pi extension registering the tools natively (Pi ships without built-in MCP).                                                                                                 |
| `vercel-ai/`      | Vercel AI SDK example over MCP/stdio via `createMCPClient`.                                                                                                                  |

Each example is a self-contained project: install, export `BROWSERBASE_API_KEY`, and run —
see the directory's README. TypeScript examples consume `core/` as a workspace dependency; the Python projects resolve the published
`stagehand` package.
