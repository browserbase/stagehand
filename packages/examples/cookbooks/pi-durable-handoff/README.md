# Resume a Notion task after human login

List visible page links from a Notion workspace. When login needs human verification, save the handoff, exit the CLI, and let the human finish in Browserbase Live View. Resume the same task and save the workspace links.

Official Earendil Pi Durable on SQLite. TypeScript CLI, Browserbase only. No application deployment required.

## Install and run

```bash
cd typescript
cp .env.example .env
pnpm install --frozen-lockfile
```

Fill in the environment template. Node.js 24.18+ and pnpm are required. `BROWSERBASE_API_KEY`, `OPENAI_API_KEY` and `NOTION_EMAIL` are required. The OpenAI key powers Pi. Stagehand provides deterministic browser tools and needs no separate browser model.

```bash
pnpm start
# Open the printed Live View URL and enter the verification code there.
pnpm start status
pnpm start return <decision-id>
```

Run `pnpm start status` to inspect saved state. `pnpm start cleanup` releases the Browserbase session and retains history. To start a separate task, choose a new `STATE_DIR`; do not delete uncertain submission history to retry an action.

Earendil describes Pi Durable as experimental. These examples pin its published `1.3.0` release; the version pin does not imply a stable API guarantee.

## Follow the code

1. `src/scenario.ts` defines the login tools. `handoff` writes the decision before returning.
2. `src/pi.ts` registers those tools and stores their application state with `defineDoc`. A pending decision terminates the Pi turn.
3. `src/index.ts` reopens SQLite on each invocation. `return <id>` updates the decision and submits a stable `return:<id>` input.
4. `read_workspace` checks the live workspace sidebar and saves up to 20 visible links. The stored human return alone does not establish that the original task succeeded.

The CLI exits during verification. It does not keep a process asleep waiting for terminal input. Restarting the CLI reconnects to the saved browser, provided that session is still alive.

## Why durability matters

The pending handoff is a Pi application document in `agent.sqlite`. The browser binding and decision ID survive reopen. The initial prompt and each return use stable request IDs. A replayed handoff reuses its original decision, including a decision the human already completed.

The agent uses `begin_login`, `snapshot`, `run`, `screenshot`, `handoff` and `read_workspace`. Login actions are not replay-safe. The human enters passwords, CAPTCHA answers and codes in Live View. Automation stops while handoff is pending. The result contains the current URL, browser title and up to 20 visible sidebar links. It covers those links, without crawling workspace contents. If Notion changes its sidebar DOM, update the check rather than accepting an unverified success.

An email code or CAPTCHA is not guaranteed on every login. This recipe targets an existing account and does not sign up a new one. The configured email is read from the environment, not hardcoded. The model can see account content after login; use an account appropriate for your testing.

## Browser operations

Pi chooses each next tool. `snapshot` returns a compact accessibility tree including iframes. `run` supports a single `{ op: "click", id }` action using the latest snapshot. This is a bounded subset of the integration tools, without JavaScript execution. The saved login-attempt marker prevents a second automated click, including after a crash. Further login steps belong to the human. Snapshot targets stay in memory and are invalid after a run call or when the tab or URL changes. Take a fresh snapshot after human interaction. `screenshot` returns a PNG image to Pi when visual inspection helps.

Use the printed Browserbase session link to inspect execution and Live View for human interaction. These recipes use task-specific tools and DOM-based completion checks. Screenshots are optional visual evidence; they do not replace persisted decisions or confirmation checks.

After 30 browser tool calls, the next call saves a handoff instead of continuing. Inspect the page in Live View and run `return <decision-id>` to grant another 30 calls. Returning the same decision twice does not grant another batch. Progress, result and login-attempt markers remain saved.

## Recovery and limits

Browser lifetime is 30 minutes, including time spent waiting for you. The pinned Browserbase SDK 2.22.0 calls this option `api_timeout`, in seconds, and sends it as `timeout` to the API. The Browserbase plan must support keep-alive. Keeping the agent state does not extend a browser, login code, reservation, or price quote. Reconnect failures stop the recipe rather than silently create a fresh browser and replay actions. Once a run completes, release its browser with `cleanup`.

Live View URLs are freshly requested for the active page. They grant interactive access; this CLI prints them locally and does not save them in output files. Keep automation paused while the human controls the page. The pending request is durable even when the CLI is gone. The browser remains billable while alive. Browser and tool limits are not a fixed cost cap.

Run one CLI process per `STATE_DIR`. A filesystem lock prevents competing writers and becomes stale 30 seconds after a crashed process stops updating it. Do not bypass that lock. Resume on the same machine and disk with the same environment and package pins. Remote deployment needs a worker and appropriate persistent storage.

## Manual browser check

Run until a handoff appears, exit, complete Notion verification in Live View, then run `return <decision-id>` from another CLI process. Expect the same Browserbase session, `confirmed: true` and a nonempty `workspace.pages` result in `status.json`. Also try a wrong decision ID and confirm it cannot resume automation.

These steps are for your live verification; they have not been run as part of this change.

## Verify

```bash
pnpm typecheck
pnpm test
```

The tests reopen real SQLite storage and verify request deduplication, persisted handoff, browser ownership, stale snapshot rejection, a single login attempt, image output and bounded work after human return. Keep these focused recovery tests when adapting the example. They run without credentials or network access; they cannot prove that a real website login or submission works. Live sites and paid model execution have not been tested as part of this change. Read the [cookbook docs](https://docs.stagehand.dev/v4/cookbooks/pi-durable-handoff) for the agent prompt and deployment boundaries.
