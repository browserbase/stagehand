# Turn a leaderboard into structured data

Read two benchmark leaderboards on stagehand.dev/evals and return the top 10 models of each as JSON.

Live demo, recording and cost comparison: https://stagehand.dev/showcase/stagehand-evals-leaderboard

## Why it's hard

The data lives in an interactive client-side view, not a file you can download.

- Each benchmark sits behind a switcher that re-renders the table in place
- Rows mix percentages, dollars and seconds in display formatting
- Charts and tables show the same models in different orders

## Run it with the code-mode agent

This is what the recording and the headline numbers show: Claude Code with Stagehand's code-mode MCP server, which exposes `run`, `snapshot` and `screenshot`. From the repository root:

```bash
pnpm install
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
export ANTHROPIC_API_KEY=... BROWSERBASE_API_KEY=...
cd packages/integrations/claude-code
claude -p 'On stagehand.dev/evals, read the leaderboard for the "Browserbase Benchmark v2" benchmark and then for the "Online Mind2Web" benchmark. For each, report the top 10 rows with rank, model, harness, accuracy in percent, cost per task in USD and seconds per task (null if not shown).' \
  --mcp-config .mcp.json --allowedTools "mcp__stagehand__run,mcp__stagehand__snapshot,mcp__stagehand__screenshot"
```

## Run it as a script

Once the flow works, `workflow.ts` runs it as plain Stagehand calls, with no agent. Copy `packages/examples/.env.example` to `packages/examples/.env`, fill in `BROWSERBASE_API_KEY` and `ANTHROPIC_API_KEY`, then from the repository root:

```bash
just cookbook stagehand-evals-leaderboard
```

## Files

- `task.ts`: the goal given to the agents, and the success check applied to every run
- `workflow.ts`: the same flow as a plain Stagehand script, a `run(stagehand, page)` function
- `index.ts`: opens a Browserbase session and runs the script
