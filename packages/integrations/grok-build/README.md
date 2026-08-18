# Grok Build + Stagehand over ACP

This example starts the packaged Grok Build CLI as an ACP v1 agent and mounts the persistent Stagehand facade as its only session MCP server.

## Run

From the repository root:

```bash
pnpm install
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
export XAI_API_KEY=xai-...
pnpm --dir packages/integrations/grok-build start -- \
  "Open https://example.com, snapshot it, request a screenshot, and report the title."
```

An existing `grok login` can be used instead of `XAI_API_KEY`. Grok uses its configured default model. Browser selection continues to use `STAGEHAND_BROWSER`, `BROWSERBASE_API_KEY`, and `BROWSERBASE_PROJECT_ID`.

## Isolation

Each run creates a disposable workspace, home directory, and `GROK_HOME`, copies only cached `auth.json` when API-key auth is unavailable, and disables user compatibility MCP imports. The ACP session supplies exactly one `stagehand` stdio server. A minimal launcher creates the actual facade runtime with non-empty `STAGEHAND_*` and `BROWSERBASE_*` values plus basic OS values needed to launch Node and local Chrome, so `XAI_API_KEY` and unrelated host secrets are unavailable to the facade.

The shared `@browserbasehq/stagehand-integrations/acp` transport handles protocol initialization, auth, session updates, permission decisions, cancellation, and process-tree cleanup. This package supplies only Grok's command and protocol-specific profile behavior.

The Grok process is restricted to `search_tool` and `use_tool` through an ACP `--agent-profile` allowlist so it can discover and invoke the lazy Stagehand MCP tools. Shell, file, subagent, memory, plan, and web-search capabilities are disabled for this browser-only example, matching the Claude and Codex integrations.
