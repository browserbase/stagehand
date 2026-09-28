# Compare laptop specs across product pages

Search Staples, open the top three laptops and normalize their specs into one table.

Live demo, recording and cost comparison: https://stagehand.dev/showcase/laptop-spec-comparison

## Why it's hard

Each product page hides the numbers you need behind a tab, in a slightly different layout.

- Specs sit behind a tab below the fold that only renders once opened
- Sponsored tiles are mixed into the search results
- Only the first row of results renders until the page is scrolled

## Run it with the code-mode agent

This is what the recording and the headline numbers show: Claude Code with Stagehand's code-mode MCP server, which exposes `run`, `snapshot` and `screenshot`. From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
export ANTHROPIC_API_KEY=... BROWSERBASE_API_KEY=...
cd packages/integrations/claude-code
claude -p 'Search Staples for "laptops 16gb ram". Open the first three laptops in the results that are not sponsored and, for each, report the name, current price in USD, processor, RAM in GB, storage in GB, screen size in inches, weight in pounds (null if not listed) and the product page URL.' \
  --mcp-config .mcp.json --allowedTools "mcp__stagehand__run,mcp__stagehand__snapshot,mcp__stagehand__screenshot"
```

## Run it as a script

Once the flow works, `workflow.ts` runs it as plain Stagehand calls, with no agent. Copy `packages/examples/.env.example` to `packages/examples/.env`, fill in `BROWSERBASE_API_KEY` and `ANTHROPIC_API_KEY`, then from the repository root:

```bash
just cookbook laptop-spec-comparison
```

## Files

- `task.ts`: the goal given to the agents, and the success check applied to every run
- `workflow.ts`: the same flow as a plain Stagehand script, a `run(stagehand, page)` function
- `index.ts`: opens a Browserbase session and runs the script
