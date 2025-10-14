---
"@browserbasehq/stagehand": minor
---

Add multi-client browser server support

This release adds support for Playwright's `launchServer()` and `connect()` APIs, enabling multiple Stagehand clients to connect to and control the same browser instance.

## New Features

### Browser Server Environment

Added new `BROWSERSERVER` environment type that allows launching or connecting to a browser server:

```typescript
// Launch a new browser server
const stagehand = new Stagehand({
  env: "BROWSERSERVER",
  browserServerOptions: {
    headless: false,
    port: 9222,
  },
});
await stagehand.init();
const endpoint = stagehand.wsEndpoint();

// Connect to an existing browser server
const client = new Stagehand({
  env: "BROWSERSERVER",
  wsEndpoint: endpoint,
});
await client.init();
```

### Static Server Launcher

Added static method for launching a browser server separately from clients:

```typescript
const server = await Stagehand.launchServer({
  headless: false,
  port: 9222,
});
const endpoint = server.wsEndpoint();

// Pass endpoint to multiple clients
const client1 = new Stagehand({ env: "BROWSERSERVER", wsEndpoint: endpoint });
const client2 = new Stagehand({ env: "BROWSERSERVER", wsEndpoint: endpoint });
```

### New API Methods

- `stagehand.wsEndpoint()` - Returns the WebSocket endpoint for the browser server
- `Stagehand.launchServer(options)` - Static method to launch a browser server

## Use Cases

1. **Development & Debugging** - Inspect running automations from another process
2. **Distributed Agents** - Multiple agents collaborating in the same browser
3. **Hot Reload** - Restart code without losing browser state
4. **Multi-Process Automation** - Share browser instance across services

## Configuration

New `BrowserServerOptions` interface with the following options:

- `headless` - Run in headless mode
- `port` - Port to bind to (default: random)
- `host` - Host to bind to (default: localhost)
- `args` - Chrome arguments
- `timeout` - Launch timeout
- `chromiumSandbox` - Enable Chrome sandbox
- `devtools` - Auto-open DevTools
- `downloadsPath` - Downloads directory
- `executablePath` - Custom Chrome executable path
- `proxy` - Proxy configuration
- And more...

## Examples

Examples demonstrating multi-client usage are available in `examples/multi-client/`:

- `launchServer.ts` - Launch a browser server
- `connectClient.ts` - Connect to an existing server
- `multipleAgents.ts` - Multiple clients working together
- `hotReload.ts` - Hot reload development workflow

## Breaking Changes

None - this is a fully backward-compatible addition.

## Technical Details

- Updated `types/stagehand.ts` to add `BROWSERSERVER` environment type
- Updated `types/browser.ts` to support browser server in results
- Modified `lib/index.ts` to handle browser server launch/connect logic
- Enhanced `getBrowser()` function to support BROWSERSERVER environment
- Updated `close()` method to properly shut down browser servers
- All AI features (act, extract, observe, agent) work normally with connected clients
