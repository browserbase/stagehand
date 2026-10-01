# Catch UI regressions with one test across app variants

Run the same checkout test against a working store and two deliberately buggy builds, and report what broke.

Live demo, recording and cost comparison: https://stagehand.dev/showcase/qa-find-ui-regressions

## Why it's hard

A selector-based test has to be rewritten per variant; one written as intent runs unchanged and reports the bugs it finds.

- The buggy builds keep the page structure but break behaviour
- Failures must be reported as findings, not crash the run
- Each account needs a clean cart, stored in the browser

## Run it with the code-mode agent

This is what the recording and the headline numbers show: Claude Code with Stagehand's code-mode MCP server, which exposes `run`, `snapshot` and `screenshot`. From the repository root:

```bash
pnpm install
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
export ANTHROPIC_API_KEY=... BROWSERBASE_API_KEY=...
cd packages/integrations/claude-code
claude -p 'On saucedemo.com (password secret_sauce), run the same checkout test for each of standard_user, problem_user and error_user, starting each one with an empty cart: log in, add "Sauce Labs Backpack" and "Sauce Labs Bike Light" to the cart, open the cart, check out as Ada Lovelace with ZIP 94103, continue and finish. For each user, report pass/fail for these checks, stopping a user'\''s test at the first failed check: "both items in cart", "checkout info accepted", "order confirmed"; and list any issues found, in plain words.' \
  --mcp-config .mcp.json --allowedTools "mcp__stagehand__run,mcp__stagehand__snapshot,mcp__stagehand__screenshot"
```

## Run it as a script

Once the flow works, `workflow.ts` runs it as plain Stagehand calls, with no agent. Copy `packages/examples/.env.example` to `packages/examples/.env`, fill in `BROWSERBASE_API_KEY` and `ANTHROPIC_API_KEY`, then from the repository root:

```bash
just cookbook qa-find-ui-regressions
```

## Files

- `task.ts`: the goal given to the agents, and the success check applied to every run
- `workflow.ts`: the same flow as a plain Stagehand script, a `run(stagehand, page)` function
- `index.ts`: opens a Browserbase session and runs the script
