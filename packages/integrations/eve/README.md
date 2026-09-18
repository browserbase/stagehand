# Browserbase for Eve

The provider-official [Eve extension](https://eve.dev/docs/extensions) for Browserbase, powered by
[Stagehand V4 Code Mode](https://docs.stagehand.dev/v4). It gives an Eve agent one persistent
Browserbase browser through three native tools: `run`, `snapshot`, and `screenshot`.

## Install

Use Node.js 24 or newer, pnpm 10 or newer, and Eve `>=0.39.3 <1`.

```bash
pnpm add @browserbasehq/eve
```

Mount the extension under the `browserbase` namespace:

```ts
// agent/extensions/browserbase.ts
import browserbase from "@browserbasehq/eve";

export default browserbase({
  apiKey: process.env.BROWSERBASE_API_KEY!,
});
```

Add that file to any existing Eve agent. Eve discovers the mounted tools automatically.

Eve automatically preserves Stagehand and the Browserbase SDK as external runtime dependencies.
You can keep the consuming agent's existing `build.externalDependencies` configuration.

## Tools

| Tool                      | Purpose                                                  |
| ------------------------- | -------------------------------------------------------- |
| `browserbase__run`        | Run Playwright-shaped JavaScript or snapshot-ID actions. |
| `browserbase__snapshot`   | Inspect the page and hydrate IDs for subsequent actions. |
| `browserbase__screenshot` | Capture visual evidence from the active page.            |

JavaScript passed to `run` receives Playwright-shaped `page`, `context`, and `browser` objects. It
can call `await browser.close()` after collecting the result to release the owned browser.

Version 0.2 replaces the previous focused `search`, `fetch`, session, navigation, action, and
extraction tools with this Code Mode surface. Eve's built-in `web_search` and `web_fetch` remain
available unless the consuming agent explicitly overrides them.

## Configuration

| Option                  | Default               | Description                                                 |
| ----------------------- | --------------------- | ----------------------------------------------------------- |
| `apiKey`                | required              | Browserbase API key for browser sessions and Model Gateway. |
| `model`                 | `openai/gpt-5.4-mini` | Underlying Stagehand client model identifier.               |
| `sessionTimeoutSeconds` | `900`                 | Browserbase session timeout from 60 to 21,600 seconds.      |
| `proxies`               | `false`               | Enable Browserbase proxies for new sessions.                |

Browser-only tool calls do not invoke a Stagehand model or require a separate model-provider key.
Configure Eve’s own agent model and its authentication separately. Set `BROWSERBASE_PROJECT_ID` in
the runtime environment to select a non-default Browserbase project.

## Lifecycle and security

The tools share one browser for the Eve process. The extension serializes operations, retries
initialization after transient failures, and replaces unhealthy resources. Browserbase sessions use
`keepAlive: false`; `browser.close()` closes both Stagehand and the browser, and the next tool call
starts a fresh session.

Stagehand runs model-authored JavaScript in its browser extension. Treat it as powerful browser-side
code with access to the authenticated browser session, not as a hostile-code sandbox. Concurrent
Eve sessions in one process share pages, cookies, and authentication state.

Every `snapshot` hydrates its displayed IDs for `run` actions. Snapshot output renders an ID like
`[0-22]`, while the action passes only the inner value (`id: "0-22"`) without brackets. Snapshot IDs
expire after navigation or a newer snapshot, so inspect the page again before retrying a stale
action.

## Development

```bash
pnpm --filter @browserbasehq/eve typecheck
pnpm --filter @browserbasehq/eve test:unit
pnpm --filter @browserbasehq/eve build
pnpm --filter @browserbasehq/eve pack
```
