# Stagehand for Claude Code

```sh
claude plugin marketplace add browserbase/stagehand
claude plugin install stagehand@browserbase-stagehand
```

The plugin uses the official Claude Code marketplace format and mounts the Stagehand MCP server. Requires Node.js 24+ and local Chrome, or an exported `BROWSERBASE_API_KEY`. Restart Claude Code after installation. The first `@browserbasehq/stagehand-mcp@0.1.0` npm release is required before marketplace installation can start the server.

For development, build `packages/integrations/mcp` and point a temporary copy of `.mcp.json` at its built `dist/server.mjs`. Validate the plugin with `claude plugin validate ./packages/integrations/claude-code/plugin`.
