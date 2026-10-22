# Resume receipt collection with libfx

Read receipt metadata from merchant portal pages, hand login to a human when needed, and resume incomplete pages after a crash.

Native libfx durable sessions. TypeScript CLI, Browserbase only. No application deployment required.

## Install and run

```bash
cd typescript
cp .env.example .env
pnpm install --frozen-lockfile
```

Fill in the environment template. Node.js 24.18+ and pnpm are required. `BROWSERBASE_API_KEY` and `OPENAI_API_KEY` power browser extraction. `AI_GATEWAY_API_KEY` powers the libfx agent. Set `RECEIPT_URLS` to a JSON array of one to five real merchant receipt-list URLs.

```bash
pnpm start
# If login blocks extraction, use the printed Live View:
pnpm start return <decision-id>
# After an interruption:
pnpm start resume
```

Run `pnpm start status` to inspect saved state. `pnpm start cleanup` releases the Browserbase session and retains history. To start a separate task, choose a new `STATE_DIR`; do not delete uncertain submission history to retry an action.

## Follow the code

1. `src/index.ts` creates a libfx agent with `local({ dir })`. libfx owns conversation and tool recovery.
2. `read_receipts` checks `src/store.ts` for a completed source before opening its URL. It saves extracted records before returning the tool result.
3. A crash after that save can leave the tool unfinished in libfx. Repeating the read returns the saved source instead of extracting it again.
4. Initial and human-return inputs have stable message IDs. Reissuing an input also covers a crash before libfx accepted it.

`receipts.json` reports whether every configured source has saved records. That flag does not mean every receipt in the account was collected. This recipe covers the visible page, without pagination or PDF downloads. Empty pages remain incomplete because the current schema cannot distinguish an empty account from a blocked page.

## Why durability matters

libfx's own `createFxAgent` persists turns and tool outcomes. This recipe explicitly selects its local durable backend, not the in-memory engine or fx CLI. Its application manifest is a separate, atomically replaced file beside the session files. Keep the whole `STATE_DIR` together; replacing libfx's backend alone does not move that manifest to a cloud database.

`read_receipts` serializes navigation and extraction and accepts only configured source URLs. A completed page returns saved records. An interrupted read can run again. A page with no visible receipts stays incomplete; the model may request human login, but it cannot invent a completed page. Pages can redirect through the merchant's login flow. Configure only portals you intend the agent to access.

The output is receipt metadata, not downloaded PDFs. Extraction covers up to 50 visible records per source, without pagination. Adjust the schema and completeness checks together for your portal. Saved records keep their earlier values and do not prove that every receipt in an account was collected.

To demonstrate recovery, run with `CRASH_AFTER_RECEIPT=1`. After it exits, unset the flag, wait for the stale CLI lock to clear, then run `pnpm start resume`. The saved source should be reused. Offline tests cover manifest reopen and libfx input deduplication. Live extraction and model execution remain untested.

## Browser operations

libfx decides when to read or hand off. Stagehand navigates only to configured sources and uses `extract` with a receipt schema. The manifest records completed sources, so resumed runs reuse those results. A human signs in through Live View when a source is blocked.

Use the printed Browserbase session link to inspect execution and Live View for human interaction. These recipes use task-specific tools and DOM-based completion checks. Screenshots are optional visual evidence; they do not replace persisted decisions or confirmation checks.

After 20 extraction attempts, the next incomplete source saves a handoff. Inspect the page and run `return <decision-id>` to grant another 20 attempts. Completed sources remain saved and do not consume the new budget.

## Recovery and limits

Browser lifetime is 30 minutes, including time spent waiting for you. The pinned Browserbase SDK 2.22.0 calls this option `api_timeout`, in seconds, and sends it as `timeout` to the API. The Browserbase plan must support keep-alive. Keeping the agent state does not extend a browser, login code, reservation, or price quote. Reconnect failures stop the recipe rather than silently create a fresh browser and replay actions. Once a run completes, release its browser with `cleanup`.

Live View URLs are freshly requested for the active page. They grant interactive access; this CLI prints them locally and does not save them in output files. Keep automation paused while the human controls the page. The pending request is durable even when the CLI is gone. The browser remains billable while alive. Browser and tool limits are not a fixed cost cap.

Run one CLI process per `STATE_DIR`. A filesystem lock prevents competing writers and becomes stale 30 seconds after a crashed process stops updating it. Do not bypass that lock. Resume on the same machine and disk with the same environment and package pins. Remote deployment needs a worker and appropriate persistent storage.

## Manual browser check

Use two receipt-list URLs. Run with `CRASH_AFTER_RECEIPT=1`; after the intentional crash, unset it and wait 30 seconds for the lock to expire. Resume with the same `STATE_DIR`. Check that the first source is reused and the second is collected. If login is required, complete it in Live View before returning control.

These steps are for your live verification; they have not been run as part of this change.

## Verify

```bash
pnpm typecheck
pnpm test
```

The tests reopen the manifest and a real libfx session with a synthetic model stream. They check retained receipts, message deduplication and handoff ownership. Keep these focused recovery tests when adapting the example. They run without credentials or network access; they cannot prove that a real website login or submission works. Live sites and paid model execution have not been tested as part of this change. Read the [cookbook docs](https://docs.stagehand.dev/v4/cookbooks/libfx-receipts) for the agent prompt and deployment boundaries.
