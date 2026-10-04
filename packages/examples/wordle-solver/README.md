# Solve today's Wordle

Play the NYT Wordle end to end: read the tile colors after every guess and pick the next word until it is solved.

Live demo, recording and cost comparison: https://stagehand.dev/showcase/wordle-solver

## Why it's hard

A game is a loop of acting, reading state and deciding, where every guess depends on the last board.

- Tile colors only appear after a flip animation settles
- Guesses outside Wordle's word list are rejected and must be retried
- Duplicate letters follow Wordle's own scoring rules

## Run it with the code-mode agent

This is what the recording and the headline numbers show: Claude Code with Stagehand's code-mode MCP server, which exposes `run`, `snapshot` and `screenshot`. From the repository root:

```bash
pnpm install
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
export ANTHROPIC_API_KEY=... BROWSERBASE_API_KEY=...
cd packages/integrations/claude-code
claude -p 'Play today'\''s Wordle at nytimes.com/games/wordle and solve it in six guesses or fewer. Report whether you solved it, the answer (null if not solved), and each guess in order with its tile feedback as five emoji (🟩 correct, 🟨 present, ⬛ absent).' \
  --mcp-config .mcp.json --allowedTools "mcp__stagehand__run,mcp__stagehand__snapshot,mcp__stagehand__screenshot"
```

## Run it as a script

Once the flow works, `workflow.ts` runs it as plain Stagehand calls, with no agent. Copy `packages/examples/.env.example` to `packages/examples/.env`, fill in `BROWSERBASE_API_KEY` and `ANTHROPIC_API_KEY`, then from the repository root:

```bash
just cookbook wordle-solver
```

## Files

- `task.ts`: the goal given to the agents, and the success check applied to every run
- `workflow.ts`: the same flow as a plain Stagehand script, a `run(stagehand, page)` function
- `index.ts`: opens a Browserbase session and runs the script
