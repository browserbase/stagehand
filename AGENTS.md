<!--
Only a human may request changes to this file. Keep additions rare and limited to durable, repository-wide rules.
-->

# Product map for agents

Stagehand gives agents a browser. Choose the path that fits your use case:

| You want to...                                                   | Use                      | Docs                                                               |
| ---------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------ |
| Give a coding agent (Claude Code, Cursor, Codex) a local browser | `browse` CLI + skill     | [CLI README](./packages/cli/README.md)                             |
| Build a browser agent application                                | TypeScript/Python/Go SDK | [Quickstart](https://docs.stagehand.dev/v4/first-steps/quickstart) |
| Add browser tools to an MCP client without installing anything   | Hosted Browserbase MCP   | [MCP setup](https://docs.stagehand.dev/v3/integrations/mcp/setup)  |

## Quick start for coding agents

```bash
npm install -g browse
npx skills add browserbase/stagehand --skill browse
browse open https://example.com --local
browse snapshot
browse get title
```

Requires Node.js 22.18+ and Chrome/Chromium. No LLM key or Browserbase account needed for local use. Use `--remote` with `BROWSERBASE_API_KEY` for hosted browsers.

## Key resources

- **`packages/cli`** — The `browse` CLI for terminal-based browser automation
- **`packages/sdk-ts`** — TypeScript SDK published as `@browserbasehq/stagehand`
- **`packages/sdk-python`** — Python SDK published as `stagehand`
- **`packages/sdk-go`** — Go SDK
- **`packages/docs`** — Documentation site source
- **[llms-full.txt](https://docs.stagehand.dev/llms-full.txt)** — Full v4 documentation for LLM context

---

# Contributor rules

- For stacked PRs, target each PR at its immediate predecessor; when a parent changes, merge it into its immediate child and resolve conflicts normally.
- After a parent is squash-merged as `S`, ensure its child contains the parent's final tip and verify that tip and `S` have identical trees. Record the child's current commit, run `git merge --no-edit S^` and `git merge --no-edit -s ours S`, then use `git diff` to confirm that the child's files did not change and inspect `git diff --merge-base S HEAD` as the final PR diff before pushing. Stop if either diff contains unexpected changes.
