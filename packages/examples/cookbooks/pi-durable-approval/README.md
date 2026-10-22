# Approve an order across agent restarts

Prepare a demonstration order, save the exact values, wait for terminal approval, then complete the order yourself through Live View and type Done.

Official Pi Durable with native SQLite storage. TypeScript CLI, Browserbase only. No application deployment required.

## Install and run

```bash
cd typescript
cp .env.example .env
pnpm install --frozen-lockfile
```

Fill in the environment template. Node.js 24.18+ and pnpm are required. `BROWSERBASE_API_KEY` and `OPENAI_API_KEY` are required. The OpenAI key powers Pi. The browser uses deterministic Stagehand operations and needs no browser model.

```bash
pnpm start
# In the running terminal, type: approve
# Click Submit yourself in the printed Live View.
# In the same terminal, type: done
# The agent verifies the result, then exits.
pnpm start cleanup
```

Run `pnpm start status` to inspect the saved decision and `progress.phase` without calling a model or reconnecting the browser. `progress.nextAction` tells you whether to approve, submit through Live View, or resume verification. `pnpm start cleanup` releases the Browserbase session and retains history. To start a separate task, choose a new `STATE_DIR`; do not delete uncertain submission history to retry an action.

Earendil describes Pi Durable as experimental. These examples pin its published `1.4.0` release; the version pin does not imply a stable API guarantee.

## Follow the code

1. `src/index.ts` opens `agent.sqlite` with Pi Durable's native `openNodeSqliteStorage`. Reopening it restores the same conversation.
2. `src/scenario.ts` fills a public test form and persists its exact values in a Pi document.
3. The terminal approval rereads the form and compares it with the saved proposal. The human then submits in Live View.
4. Typing Done resumes the conversation and asks Pi to verify the response; the explicit return command supports recovery after exit.

This teaches a decision that survives process exit. It does not demonstrate an agent making a purchase or a queue worker running unattended. The fixed form deliberately keeps website interaction small so you can inspect the persisted approval.

## Why durability matters

Pi Durable runs the conversation and tools, and saves browser binding, proposal, approval and confirmation as documents in SQLite. Submitting or waiting starts its scheduler. Reopening the same database restores the task. No durable-harness adapter or Workflow World is required.

`prepare_order` fills the public httpbin test order form and saves every actual form value. `approve` rereads the form and refuses changed values. The agent has no click or submit tool. After approval, the human submits through Live View. `verify_order` compares httpbin's echoed response with the approved values. A mismatch is a failure, not a successful purchase. No money moves.

Approval state survives agent restarts, but this minimal CLI does not recreate an expired checkout or Browserbase session. If the browser expires, start a fresh run and approve fresh values. A production purchase assistant must rebuild and revalidate price, contents and availability before requesting new approval.

## Browser operations

Pi chooses between preparing and verifying the order. Stagehand locators fill the known form, and `page.evaluate` reads its actual values. Approval checks those values again. The human clicks Submit in Live View; deterministic parsing checks the echoed response.

Use the printed Browserbase session link to inspect execution and Live View for human interaction. These recipes use task-specific tools and DOM-based completion checks. Screenshots are optional visual evidence; they do not replace persisted decisions or confirmation checks.

## Recovery and limits

Browser lifetime is 30 minutes, including time spent waiting for you. The Browserbase plan must support keep-alive. Keeping the agent state does not extend a browser, login code, reservation, or price quote. Reconnect failures stop the recipe rather than silently create a fresh browser and replay actions. Once a run completes, release its browser with `cleanup`.

Live View URLs are freshly requested for the active page. They grant interactive access; this CLI prints them locally and does not save them in output files. Keep automation paused while the human controls the page. The pending request is durable even when the CLI is gone. The browser remains billable while alive. Browser and tool limits are not a fixed cost cap.

Run one CLI process per `STATE_DIR`. A filesystem lock prevents competing writers. After a crash, the next command waits up to 35 seconds for the stale lock to clear. Do not delete or bypass an active lock. Resume on the same machine and disk with the same environment and package pins. Remote deployment needs a worker and appropriate persistent storage.

## Manual browser check

Prepare an order and inspect it in Live View while the terminal waits. Change a field before typing `approve` and expect refusal. Restore the saved values, approve, submit in Live View, then type `done`. Expect a matching confirmation. Do not submit before approval.

## Verify

```bash
pnpm typecheck
```

Read the [cookbook docs](https://docs.stagehand.dev/v4/cookbooks/pi-durable-approval) for the agent prompt and deployment boundaries.

Shared dependencies follow the existing cookbook ranges: `typescript@^5`, `@types/node@^24`, `tsx@^4.23.1`, `dotenv@^17.4.2`, `@browserbasehq/sdk@^2.16.0` and `zod@4.4.3`. Framework packages keep exact pins. Install with the frozen lockfile.
