<!--
Only a human may request changes to this file. Keep additions rare and limited to durable, repository-wide rules.
-->

# Product map for agents

Stagehand is the SDK for building browser agents. Choose the path that fits your use case:

| You want to...                                                   | Use                      | Docs                                                               |
| ---------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------ |
| Build a browser agent application                                | TypeScript/Python/Go SDK | [Quickstart](https://docs.stagehand.dev/v4/first-steps/quickstart) |
| Give a coding agent (Claude Code, Cursor, Codex) a local browser | `browse` CLI + skill     | [CLI README](./packages/cli/README.md)                             |
| Add browser tools to an MCP client without installing anything   | Hosted Browserbase MCP   | [MCP setup](https://docs.stagehand.dev/v3/integrations/mcp/setup)  |

## Using a coding agent?

If you're using Claude Code, Cursor, Codex, or another coding agent interactively, install the `browse` CLI and skill:

```bash
npm install -g browse
npx skills add browserbase/stagehand --skill browse
browse open https://example.com --local
browse snapshot
browse get title
```

Requires Node.js 22.18+ and Chrome/Chromium. No LLM key or Browserbase account needed for local use. Use `--remote` with `BROWSERBASE_API_KEY` for hosted browsers.

## Key resources

- **`packages/sdk-ts`** — TypeScript SDK published as `@browserbasehq/stagehand`
- **`packages/sdk-python`** — Python SDK published as `stagehand`
- **Go SDK** — [README](https://github.com/browserbase/stagehand-go)
- **`packages/cli`** — The `browse` CLI for terminal-based browser automation
- **`packages/docs`** — Documentation site source
- **[llms-full.txt](https://docs.stagehand.dev/llms-full.txt)** — Full v4 documentation for LLM context

---

# Contributor rules

- Write changesets as one terse, user-facing sentence—no file names, test notes, or multi-paragraph explanations. See [`.changeset/README.md`](.changeset/README.md).
