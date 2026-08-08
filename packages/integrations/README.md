# Stagehand code mode

`@browserbasehq/stagehand-codemode` is a stateful Model Context Protocol (MCP) server that gives an
agent one `code_execute` tool backed by Stagehand. One server process owns one browser session, so
pages, cookies, JavaScript state, and navigation persist across tool calls.

> **Security:** `stagehand-codemode` executes arbitrary JavaScript with the permissions of its own
> process. The package is not a sandbox. Run it inside an isolation boundary when code is generated
> by a model or is otherwise untrusted.

## Install and run

Use an exact version in MCP client configuration:

```json
{
  "mcpServers": {
    "stagehand": {
      "command": "npx",
      "args": ["-y", "@browserbasehq/stagehand-codemode@4.0.0"],
      "env": {
        "STAGEHAND_BROWSER": "browserbase",
        "BROWSERBASE_API_KEY": "<browserbase-api-key>",
        "BROWSERBASE_PROJECT_ID": "<browserbase-project-id>"
      }
    }
  }
}
```

For a trusted local browser:

```bash
STAGEHAND_BROWSER=local npx -y @browserbasehq/stagehand-codemode@4.0.0
```

The executable writes MCP protocol frames only to stdout. Readiness and diagnostics go to stderr.
It exposes exactly one MCP tool: `code_execute`.

## Configuration

| Variable                                                           | Purpose                                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `STAGEHAND_BROWSER`                                                | Optional `local` or `browserbase` override                       |
| `BROWSERBASE_API_KEY`                                              | Selects and authenticates Browserbase when present               |
| `BROWSERBASE_PROJECT_ID`                                           | Optional Browserbase project forwarded when creating a session   |
| `STAGEHAND_MODEL_NAME`                                             | Optional Stagehand model name                                    |
| `STAGEHAND_MODEL_API_KEY`                                          | Optional explicit model-provider key                             |
| Provider API keys                                                  | Supplies the key for a matching explicit model provider          |
| `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_API_KEY` | Selects `google/gemini-2.5-flash-lite` when no model is explicit |

Without a browser override, the server selects Browserbase when `BROWSERBASE_API_KEY` exists and a
headless local browser otherwise.

## Lifecycle and hard timeouts

The process stays alive until stdin ends. `SIGINT` and `SIGTERM` perform bounded graceful cleanup and
preserve conventional signal exit codes.

JavaScript that blocks the Node.js event loop cannot be interrupted by an in-process timer. The
owning sandbox or process supervisor must enforce a wall-clock deadline, terminate the complete
process tree, escalate to `SIGKILL` when needed, and create a fresh process before accepting more
work. Killing only the Node.js process can leave a local browser child running.

For model-generated code, run the executable inside a disposable microVM or equivalent isolation
boundary. Apply separate filesystem, egress, credential, quota, and browser-navigation policies for
the authority your application intends to grant.

## Agent guidance

The published package includes the model-facing assets as exported package files:

- `@browserbasehq/stagehand-codemode/SKILL.md`
- `@browserbasehq/stagehand-codemode/REFERENCE.md`

The first public release intentionally supports the executable and these two assets only. Internal
implementation modules and an in-process arbitrary-code executor are not public package APIs.

## Framework examples

- [Vercel Sandbox](./examples/vercel-sandbox) installs the exact packed artifact inside a
  Firecracker microVM and returns a framework-neutral, bearer-authenticated MCP connection.
