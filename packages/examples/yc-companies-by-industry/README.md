# Build a list of YC startups in an industry

Turn the Y Combinator directory's Developer Tools page into a clean list of 30 companies with batch and location.

Live demo, recording and cost comparison: https://stagehand.dev/showcase/yc-companies-by-industry

## Why it's hard

A directory built for browsing, not exporting: hundreds of cards rendered client-side, with labels that come and go.

- The list renders client-side after the page loads
- Hundreds of cards on one page, of which only the first 30 are wanted
- Location and batch labels are missing on some cards

## Run it with the code-mode agent

This is what the recording and the headline numbers show: Claude Code with Stagehand's code-mode MCP server, which exposes `run`, `snapshot` and `screenshot`. From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
export ANTHROPIC_API_KEY=... BROWSERBASE_API_KEY=...
cd packages/integrations/claude-code
claude -p 'From the Y Combinator directory'\''s Developer Tools industry page, report the first 30 companies listed, each with its name, one-line description, location (null if not shown) and YC batch (null if not shown).' \
  --mcp-config .mcp.json --allowedTools "mcp__stagehand__run,mcp__stagehand__snapshot,mcp__stagehand__screenshot"
```

## Run it as a script

Once the flow works, `workflow.ts` runs it as plain Stagehand calls, with no agent. Copy `packages/examples/.env.example` to `packages/examples/.env`, fill in `BROWSERBASE_API_KEY` and `ANTHROPIC_API_KEY`, then from the repository root:

```bash
just cookbook yc-companies-by-industry
```

## Files

- `task.ts`: the goal given to the agents, and the success check applied to every run
- `workflow.ts`: the same flow as a plain Stagehand script, a `run(stagehand, page)` function
- `index.ts`: opens a Browserbase session and runs the script
