# Stagehand for Codex

```sh
codex plugin marketplace add browserbase/stagehand
codex plugin add stagehand@browserbase-stagehand
```

Restart Codex after installation, or open a new task. Requires Node.js 24+, local Chrome or an exported `BROWSERBASE_API_KEY`, and the initial `@browserbasehq/stagehand-mcp@0.1.0` release. This is a repository marketplace plugin, not a claim of listing in OpenAI’s public directory.

The plugin bundles MCP configuration and forwards only the listed browser configuration variables. Keep credentials in your environment instead of the manifest. It preserves one browser across `run`, `snapshot`, and `screenshot` calls.

The MCP child receives `STAGEHAND_MODEL_NAME` and `STAGEHAND_MODEL_API_KEY` when you configure them; it does not receive Codex’s provider credential. Plain navigation, snapshots, and screenshots do not require a separate Stagehand model. See the [configuration guide](https://docs.stagehand.dev/v4/integrations/codex#configuration) for optional Stagehand model settings.
