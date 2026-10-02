# QA a checkout flow end to end

Log in to a demo store, buy two items and check the cart math and the order confirmation.

Live demo, recording and cost comparison: https://stagehand.dev/showcase/qa-checkout-flow

## Why it's hard

A QA test that survives redesigns has to describe intent, not selectors.

- Credentials must stay out of the model prompt
- The flow spans five pages of state
- Assertions check business rules like totals, not DOM

## Run it with the code-mode agent

This is what the recording and the headline numbers show: Claude Code with Stagehand's code-mode MCP server, which exposes `run`, `snapshot` and `screenshot`. From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
export ANTHROPIC_API_KEY=... BROWSERBASE_API_KEY=...
cd packages/integrations/claude-code
claude -p 'On saucedemo.com, log in as standard_user with password secret_sauce, add "Sauce Labs Backpack" and "Sauce Labs Bike Light" to the cart and check out as Ada Lovelace, ZIP 94103. From the checkout overview report each item and price, the subtotal, tax and total; finish the order and report the confirmation heading. Also report these checks as pass/fail: cart has both items, subtotal equals item prices, total equals subtotal plus tax, order confirmed.' \
  --mcp-config .mcp.json --allowedTools "mcp__stagehand__run,mcp__stagehand__snapshot,mcp__stagehand__screenshot"
```

## Run it as a script

Once the flow works, `workflow.ts` runs it as plain Stagehand calls, with no agent. Copy `packages/examples/.env.example` to `packages/examples/.env`, fill in `BROWSERBASE_API_KEY` and `ANTHROPIC_API_KEY`, then from the repository root:

```bash
just cookbook qa-checkout-flow
```

## Files

- `task.ts`: the goal given to the agents, and the success check applied to every run
- `workflow.ts`: the same flow as a plain Stagehand script, a `run(stagehand, page)` function
- `index.ts`: opens a Browserbase session and runs the script
