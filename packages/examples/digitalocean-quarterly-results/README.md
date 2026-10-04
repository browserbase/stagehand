# Pull the latest quarterly results of a public company

Navigate DigitalOcean's investor relations site to the newest earnings release and extract revenue, profit, ARR and guidance.

Live demo, recording and cost comparison: https://stagehand.dev/showcase/digitalocean-quarterly-results

## Why it's hard

Investor sites bury the numbers two clicks deep, in long releases mixing prose, bullets and GAAP tables.

- The newest release has to be found from a list of quarters
- Release links open in a new window
- Figures sit in prose, highlight bullets and tables, in different units

## Run it with the code-mode agent

This is what the recording and the headline numbers show: Claude Code with Stagehand's code-mode MCP server, which exposes `run`, `snapshot` and `screenshot`. From the repository root:

```bash
pnpm install
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
export ANTHROPIC_API_KEY=... BROWSERBASE_API_KEY=...
cd packages/integrations/claude-code
claude -p 'On DigitalOcean'\''s investor relations site, find the earnings press release for the most recent quarter and report: the quarter (e.g. Q2 2026), revenue in millions of USD, year-over-year revenue growth in percent, GAAP net income, adjusted EBITDA, adjusted free cash flow and annual run-rate revenue (all in millions of USD, null if not reported), the revenue guidance range for the next quarter and for the full year (null if not given), and the press release URL.' \
  --mcp-config .mcp.json --allowedTools "mcp__stagehand__run,mcp__stagehand__snapshot,mcp__stagehand__screenshot"
```

## Run it as a script

Once the flow works, `workflow.ts` runs it as plain Stagehand calls, with no agent. Copy `packages/examples/.env.example` to `packages/examples/.env`, fill in `BROWSERBASE_API_KEY` and `ANTHROPIC_API_KEY`, then from the repository root:

```bash
just cookbook digitalocean-quarterly-results
```

## Files

- `task.ts`: the goal given to the agents, and the success check applied to every run
- `workflow.ts`: the same flow as a plain Stagehand script, a `run(stagehand, page)` function
- `index.ts`: opens a Browserbase session and runs the script
