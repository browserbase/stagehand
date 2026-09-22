# Stagehand MCP

The canonical Stagehand facade packaged for agent plugins. Exposes `run`, `snapshot`, and `screenshot` over stdio, with one persistent browser per server process.

```sh
npx -y @browserbasehq/stagehand-mcp@0.1.0
```

To test this repository before publishing, run `pnpm exec turbo run build --filter @browserbasehq/stagehand-mcp` and use `node packages/integrations/mcp/dist/server.mjs`. Once Browserbase publishes 0.1.0, use the `npx` command above.

Requires Node.js 24+ and Chrome for local browsing. Set `STAGEHAND_BROWSER=browserbase` and export `BROWSERBASE_API_KEY` to use Browserbase. The server reads Stagehand configuration from the process environment; do not put credentials in plugin manifests. Build output bundles Core's implementation and leaves the public Stagehand SDK external so its browser extension assets are installed with it.
