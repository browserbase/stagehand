# Reconcile an interrupted browser submission

Submit an approved test form, interrupt the process after the click, and recover by checking the confirmation instead of clicking Submit again.

OpenCode v2 on durable-harness. TypeScript CLI, Browserbase only. No application deployment required.

## Install and run

```bash
cd typescript
cp .env.example .env
pnpm install --frozen-lockfile
```

Fill in the environment template. Node.js 24.18+ and pnpm are required. `BROWSERBASE_API_KEY` and `AI_GATEWAY_API_KEY` are required. The gateway key powers OpenCode. Deterministic Stagehand browser operations need no separate OpenAI key or browser model.

```bash
pnpm start
# In the running terminal, type: approve
# OpenCode submits once, verifies the response and exits.
pnpm start status
pnpm start cleanup
```

Run `pnpm start status` to inspect saved state. `pnpm start cleanup` releases the Browserbase session and retains history. To start a separate task, choose a new `STATE_DIR`; do not delete uncertain submission history to retry an action.

## Follow the code

1. `src/index.ts` creates OpenCode through `durable-harness/opencode` and persists application state in a World document.
2. `src/state.ts` checks approval and exact form values. The submission tool commits `attempted = true` before clicking.
3. `CRASH_AFTER_SUBMIT=1` stops the process after the click but before its tool result is saved.
4. On resume, the CLI sees `attempted` and verifies the current response directly, without asking the model to submit again.

The marker is conservative. A crash between saving it and clicking leaves an uncertain outcome even if nothing was submitted. httpbin does not offer a transaction lookup or idempotency key, so the cookbook stops for manual review. A real service with those APIs can support stronger reconciliation.

## Why durability matters

OpenCode runs its agent loop inside durable-harness. Its events and tool results are stored in a local World. The model gets only `prepare_request`, `submit_request` and `verify_request`; it has no general browser or shell tool that could bypass the submission guard.

The prepared request includes a reference in its comments. The approval is tied to the exact form values. Before clicking Submit, the tool commits an `attempted` marker through the session document API. That write intentionally precedes the external effect. A crash after the marker but before the click can therefore leave an unsubmitted request marked uncertain. Recovery checks the page; it does not authorize another attempt.

`CRASH_AFTER_SUBMIT=1` kills the process after the click but before the tool returns. Unset it and resume; the CLI waits for the stale lock automatically. A matching httpbin response confirms success. An expired browser, missing confirmation, or mismatched response stops with an error and requires manual review. httpbin is an echo service, not an idempotent transaction system. This example does not promise exactly-once website actions.

Keep OpenCode's packages pinned to `2.0.22`, the version this durable-harness beta supports. The latest OpenCode release may be incompatible.

This cookbook uses the explicitly pinned experimental `durable-harness@0.0.1-beta.6`. APIs may change between releases.

## Browser operations

OpenCode gets three task-specific tools. Stagehand locators prepare and submit the form. The submission tool checks approval and commits an attempt marker before clicking. Recovery parses the confirmation and compares every field against the saved request.

Use the printed Browserbase session link to inspect execution and Live View for human interaction. These recipes use task-specific tools and DOM-based completion checks. Screenshots are optional visual evidence; they do not replace persisted decisions or confirmation checks.

## Recovery and limits

Browser lifetime is 30 minutes, including time spent waiting for you. The pinned Browserbase SDK 2.22.0 calls this option `api_timeout`, in seconds, and sends it as `timeout` to the API. The Browserbase plan must support keep-alive. Keeping the agent state does not extend a browser, login code, reservation, or price quote. Reconnect failures stop the recipe rather than silently create a fresh browser and replay actions. Once a run completes, release its browser with `cleanup`.

Live View URLs are freshly requested for the active page. They grant interactive access; this CLI prints them locally and does not save them in output files. Keep automation paused while the human controls the page. The pending request is durable even when the CLI is gone. The browser remains billable while alive. Browser and tool limits are not a fixed cost cap.

Run one CLI process per `STATE_DIR`. A filesystem lock prevents competing writers. After a crash, the next command waits up to 35 seconds for the stale lock to clear. Do not delete or bypass an active lock. Resume on the same machine and disk with the same environment and package pins. Remote deployment needs a worker and appropriate persistent storage.

## Manual browser check

Prepare the request, type `pause` at the approval prompt, then set `CRASH_AFTER_SUBMIT=1` for the explicit approval command. After the intentional crash, unset it. The next command waits for the stale lock automatically. Resume with the same `STATE_DIR`. Expect confirmation recovery without another click. If the confirmation is missing, expect an unknown outcome, not a retry.

## Verify

```bash
pnpm typecheck
```

Read the [cookbook docs](https://docs.stagehand.dev/v4/cookbooks/opencode-submission) for the agent prompt and deployment boundaries.
