# Collect remote roles across different job boards

Pull remote engineering roles from Greenhouse, Ashby and Lever boards into a single schema.

Live demo, recording and cost comparison: https://stagehand.dev/showcase/remote-roles-across-ats

## Why it's hard

The same data lives in five different page structures from three different vendors.

- Greenhouse, Ashby and Lever each render boards differently
- Ashby boards render client-side after load
- 'Remote' is written a dozen different ways

## Run it with the code-mode agent

This is what the recording and the headline numbers show: Claude Code with Stagehand's code-mode MCP server, which exposes `run`, `snapshot` and `screenshot`. From the repository root:

```bash
pnpm install
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
export ANTHROPIC_API_KEY=... BROWSERBASE_API_KEY=...
cd packages/integrations/claude-code
claude -p 'Visit these job boards: https://job-boards.greenhouse.io/figma, https://job-boards.greenhouse.io/vercel, https://jobs.ashbyhq.com/notion, https://jobs.ashbyhq.com/ramp and https://jobs.lever.co/palantir. From each, collect every software engineering role that can be done remotely, with the company, the ATS (Greenhouse, Ashby or Lever), title, team (null if not shown), location and the absolute URL of the posting.' \
  --mcp-config .mcp.json --allowedTools "mcp__stagehand__run,mcp__stagehand__snapshot,mcp__stagehand__screenshot"
```

## Run it as a script

Once the flow works, `workflow.ts` runs it as plain Stagehand calls, with no agent. Copy `packages/examples/.env.example` to `packages/examples/.env`, fill in `BROWSERBASE_API_KEY` and `ANTHROPIC_API_KEY`, then from the repository root:

```bash
just cookbook remote-roles-across-ats
```

## Files

- `task.ts`: the goal given to the agents, and the success check applied to every run
- `workflow.ts`: the same flow as a plain Stagehand script, a `run(stagehand, page)` function
- `index.ts`: opens a Browserbase session and runs the script
