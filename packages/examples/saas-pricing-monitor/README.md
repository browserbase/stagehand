# Monitor SaaS pricing pages

Normalize the plans from four SaaS pricing pages into one comparable table, ready to run on a schedule.

Live demo, recording and cost comparison: https://stagehand.dev/showcase/saas-pricing-monitor

## Why it's hard

Pricing pages are marketing pages: toggles, footnotes and plans that are priced per seat, per project or not at all.

- Some pages default to annual billing behind a toggle
- Plans are priced per user, per month, or 'Contact us'
- A monitor re-runs daily, so cost per run matters

## Run it with the code-mode agent

This is what the recording and the headline numbers show: Claude Code with Stagehand's code-mode MCP server, which exposes `run`, `snapshot` and `screenshot`. From the repository root:

```bash
pnpm install
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
export ANTHROPIC_API_KEY=... BROWSERBASE_API_KEY=...
cd packages/integrations/claude-code
claude -p 'Visit the pricing pages of Linear (https://linear.app/pricing), Supabase (https://supabase.com/pricing), Vercel (https://vercel.com/pricing) and Render (https://render.com/pricing). Switch to monthly billing where there is a toggle. For each vendor list every plan with its name, monthly price in USD when billed monthly (null for custom pricing) and what the price is per.' \
  --mcp-config .mcp.json --allowedTools "mcp__stagehand__run,mcp__stagehand__snapshot,mcp__stagehand__screenshot"
```

## Run it as a script

Once the flow works, `workflow.ts` runs it as plain Stagehand calls, with no agent. Copy `packages/examples/.env.example` to `packages/examples/.env`, fill in `BROWSERBASE_API_KEY` and `ANTHROPIC_API_KEY`, then from the repository root:

```bash
just cookbook saas-pricing-monitor
```

## Files

- `task.ts`: the goal given to the agents, and the success check applied to every run
- `workflow.ts`: the same flow as a plain Stagehand script, a `run(stagehand, page)` function
- `index.ts`: opens a Browserbase session and runs the script
