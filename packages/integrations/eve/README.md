# Browserbase for Eve

The provider-official [Eve extension](https://eve.dev/docs/extensions) for Browserbase, powered by
[Stagehand V4 Code Mode](https://docs.stagehand.dev/v4). It gives an Eve agent one persistent
Browserbase browser through three native tools: `run`, `snapshot`, and `screenshot`.

## Install

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

Add that file to any existing Eve agent. The mounted tools are discovered automatically; no
dedicated example project or additional agent configuration is required.

Eve automatically preserves Stagehand and the Browserbase SDK as external runtime dependencies.
No extra `build.externalDependencies` configuration is required in the consuming agent.

## Tools

| Tool                      | Purpose                                                      |
| ------------------------- | ------------------------------------------------------------ |
| `browserbase__run`        | Run multi-step Stagehand JavaScript against the active page. |
| `browserbase__snapshot`   | Inspect the active page's accessibility tree.                |
| `browserbase__screenshot` | Capture visual evidence from the active page.                |

The `run` callback receives Stagehand V4's `page`, `context`, `act`, `observe`, and `extract`
surfaces. It can call `close()` after collecting the result to release the owned browser.

Version 0.2 replaces the previous focused `search`, `fetch`, session, navigation, action, and
extraction tools with this Code Mode surface. Eve's built-in `web_search` and `web_fetch` remain
available unless the consuming agent explicitly overrides them.

## Configuration

| Option                  | Default               | Description                                                 |
| ----------------------- | --------------------- | ----------------------------------------------------------- |
| `apiKey`                | required              | Browserbase API key for browser sessions and Model Gateway. |
| `model`                 | `openai/gpt-5.4-mini` | Stagehand Model Gateway model identifier.                   |
| `sessionTimeoutSeconds` | `900`                 | Browserbase session timeout from 60 to 21,600 seconds.      |
| `proxies`               | `false`               | Enable Browserbase proxies for new sessions.                |

Stagehand inference runs through Browserbase Model Gateway, so a separate model-provider key is not
required.

## Lifecycle and security

The tools share one browser for the Eve process. Operations are serialized, initialization retries
after transient failures, and unhealthy resources are replaced. Browserbase sessions use
`keepAlive: false`; `close()` closes both Stagehand and the browser, and the next tool call starts a
fresh session.

Model-authored JavaScript executes in Stagehand's browser extension, not Eve's Node.js process. It
is still powerful browser-side code and must not be treated as a hostile-code sandbox. Concurrent
Eve sessions in one process share pages, cookies, and authentication state.

Snapshot IDs are descriptive rather than selectors. Use CSS or XPath locators in `run`, or use
Stagehand's `act`, `observe`, and `extract` helpers.

## Development

```bash
pnpm --filter @browserbasehq/eve typecheck
pnpm --filter @browserbasehq/eve test:unit
pnpm --filter @browserbasehq/eve build
pnpm --filter @browserbasehq/eve pack
```
