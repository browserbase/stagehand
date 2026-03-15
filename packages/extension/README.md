# Stagehand Browser Extension

Chrome extension that lets you drive browser tabs with AI via [Stagehand](https://github.com/browserbase/stagehand). The extension proxies Chrome DevTools Protocol (CDP) commands between a Stagehand server and the browser using `chrome.debugger`, so Stagehand can control any tab without needing a direct CDP connection.

## Architecture

```
stagehand client ──ws──▶ server-v4 /v4/cdp ──ws──▶ extension background.ts ──chrome.debugger──▶ page
extension sidebar ──http──▶ server-v4 REST API ──────────────────────────────▲
```

- **background.ts** — Service worker that connects to the server's `/v4/extension` WebSocket endpoint. Receives `forwardCDPCommand` messages, executes them via `chrome.debugger.sendCommand()`, and forwards `chrome.debugger.onEvent` back as `forwardCDPEvent` messages.
- **sidepanel.ts** — Sidebar UI that calls the server-v4 REST API (`/v4/sessions/*`) to run `act`, `observe`, `extract`, and `agent.execute` commands.
- **server-v4 relay** (`packages/server-v4/src/routes/v4/extensionRelay.ts`) — WebSocket relay that bridges `/v4/cdp` (raw CDP from stagehand clients) and `/v4/extension` (the extension's WebSocket).

## Prerequisites

- Node.js 18+
- pnpm
- Google Chrome or Chromium

## Build

From the repo root:

```bash
pnpm install
pnpm --filter @browserbasehq/stagehand-extension build
```

Or from this directory:

```bash
pnpm run build
```

The built extension is output to `dist/`.

## Install in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select the `packages/extension/dist` folder
5. The Stagehand icon appears in the toolbar

## Usage

### 1. Start the server

The extension connects to a Stagehand server-v4 instance. Start one locally:

```bash
pnpm --filter @browserbasehq/server-v4 dev
```

By default the extension connects to `ws://127.0.0.1:3000/v4/extension`. You can change the host and port in the sidebar settings panel.

### 2. Use the sidebar

Click the Stagehand toolbar icon to open the sidebar. The sidebar lets you:

- **Attach/detach** the debugger to browser tabs
- Run **act**, **observe**, **extract**, and **agent execute** commands against the active tab
- Configure the server host, port, and model API key

### 3. Use from code

Connect a Stagehand client to the relay's CDP endpoint:

```typescript
import { Stagehand } from "@browserbasehq/stagehand";

const stagehand = new Stagehand({
  env: "LOCAL",
  localBrowserLaunchOptions: {
    cdpUrl: "ws://127.0.0.1:3000/v4/cdp",
  },
});

await stagehand.init();
const page = stagehand.context.pages()[0];
await page.goto("https://example.com");
await stagehand.act("click the login button");
await stagehand.close();
```

## Configuration

The extension reads server connection settings from `chrome.storage.local`:

| Key | Default | Description |
|-----|---------|-------------|
| `serverHost` | `127.0.0.1` | Server hostname |
| `serverPort` | `3000` | Server port |

These can be changed in the sidebar settings or programmatically:

```javascript
chrome.storage.local.set({ serverHost: "192.168.1.100", serverPort: 8080 });
```

## Development

Watch mode (rebuilds on file changes):

```bash
pnpm run watch
```

After rebuilding, go to `chrome://extensions/` and click the reload button on the Stagehand extension.

## Tests

Run all E2E tests (requires Chromium installed):

```bash
pnpm run test
```

Individual test suites:

```bash
pnpm run test:extension   # CDP proxy tests
pnpm run test:stagehand   # Stagehand library integration tests
```

Set `CHROME_PATH` if Chromium isn't at the default location:

```bash
CHROME_PATH=/usr/bin/google-chrome pnpm run test
```
