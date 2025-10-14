# Multi-Client Browser Server Examples

This directory contains examples demonstrating Stagehand's multi-client browser server functionality.

## Overview

Stagehand's browser server support allows you to:

- Launch a browser server that multiple clients can connect to
- Share a browser instance across multiple processes or services
- Debug and inspect running automations from another process
- Build distributed systems where multiple agents collaborate
- Hot-reload code without losing browser state

## Examples

### 1. Launch Server (`launchServer.ts`)

Demonstrates how to launch a browser server and expose its WebSocket endpoint.

```bash
tsx examples/multi-client/launchServer.ts
```

This will:
- Start a browser server
- Display the WebSocket endpoint
- Keep the server running for 2 minutes
- Allow other clients to connect

### 2. Connect Client (`connectClient.ts`)

Shows how to connect to an existing browser server.

```bash
# First, start a server in terminal 1:
tsx examples/multi-client/launchServer.ts

# Then, in terminal 2, connect using the displayed endpoint:
tsx examples/multi-client/connectClient.ts ws://localhost:XXXX/...
```

### 3. Multiple Agents (`multipleAgents.ts`)

Demonstrates multiple Stagehand clients working in the same browser.

```bash
tsx examples/multi-client/multipleAgents.ts
```

This example:
- Starts a browser server
- Creates two independent Stagehand clients
- Each client navigates to different URLs
- Shows how contexts are isolated

### 4. Hot Reload (`hotReload.ts`)

Demonstrates hot-reloading your code while keeping browser state.

```bash
# First run - starts a new server
tsx examples/multi-client/hotReload.ts

# Note the BROWSER_ENDPOINT from the output, then in a new terminal:
BROWSER_ENDPOINT=ws://localhost:XXXX/... tsx examples/multi-client/hotReload.ts

# You can modify hotReload.ts and restart it - the browser stays open!
```

## API Reference

### Launch a Browser Server (Static Method)

```typescript
import { Stagehand } from "@browserbasehq/stagehand";

const server = await Stagehand.launchServer({
  headless: false,
  port: 9222,        // Optional: specify port (default: random)
  host: "localhost", // Optional: specify host (default: localhost)
});

const endpoint = server.wsEndpoint();
console.log(`Connect at: ${endpoint}`);
```

### Launch Browser Server via Stagehand Instance

```typescript
const stagehand = new Stagehand({
  env: "BROWSERSERVER",
  browserServerOptions: {
    headless: false,
    port: 9222,
  },
});

await stagehand.init();
const endpoint = stagehand.wsEndpoint();

// Use normally
await stagehand.page.goto("https://example.com");

// Close the server
await stagehand.close();
```

### Connect to Existing Browser Server

```typescript
const stagehand = new Stagehand({
  env: "BROWSERSERVER",
  wsEndpoint: "ws://localhost:9222/...",
});

await stagehand.init();

// Use all Stagehand features normally
await stagehand.page.act("click the button");
const data = await stagehand.page.extract();

// Disconnect (doesn't close the server)
await stagehand.close();
```

## Options

### BrowserServerOptions

```typescript
interface BrowserServerOptions {
  headless?: boolean;          // Run in headless mode (default: false)
  port?: number;              // Port to bind to (default: random)
  host?: string;              // Host to bind to (default: localhost)
  args?: string[];            // Chrome arguments
  timeout?: number;           // Launch timeout in ms
  chromiumSandbox?: boolean;  // Enable Chrome sandbox
  devtools?: boolean;         // Auto-open DevTools
  downloadsPath?: string;     // Downloads directory
  executablePath?: string;    // Custom Chrome executable
  handleSIGHUP?: boolean;     // Handle SIGHUP signal
  handleSIGINT?: boolean;     // Handle SIGINT signal
  handleSIGTERM?: boolean;    // Handle SIGTERM signal
  ignoreDefaultArgs?: boolean | string[]; // Ignore default Chrome args
  proxy?: {                   // Proxy configuration
    server: string;
    bypass?: string;
    username?: string;
    password?: string;
  };
}
```

## Use Cases

### Development & Debugging

Start an automation in one terminal and inspect it from another:

```bash
# Terminal 1: Run automation
tsx myAutomation.ts

# Terminal 2: Connect debugger
tsx debugInspector.ts <endpoint-from-terminal-1>
```

### Distributed Agents

```typescript
// Orchestrator service
const server = await Stagehand.launchServer({ headless: false });
const endpoint = server.wsEndpoint();

// Agent 1: Research
const agent1 = new Stagehand({ env: "BROWSERSERVER", wsEndpoint: endpoint });
await agent1.init();
await agent1.page.act("search for documentation");

// Agent 2: Form filling
const agent2 = new Stagehand({ env: "BROWSERSERVER", wsEndpoint: endpoint });
await agent2.init();
await agent2.page.act("fill out the form");
```

### Hot Reload Development

Keep your browser alive during code changes:

```typescript
const endpoint = process.env.BROWSER_ENDPOINT || 
  (await Stagehand.launchServer({ headless: false })).wsEndpoint();

const stagehand = new Stagehand({ 
  env: "BROWSERSERVER", 
  wsEndpoint: endpoint 
});
// On code changes, just restart - browser stays open
```

## Best Practices

1. **Context Isolation**: Each client should typically create its own context for isolation:
   ```typescript
   const context = await stagehand.context.browser()!.newContext();
   ```

2. **Resource Cleanup**: Always close clients when done, but only close the server when all work is complete.

3. **Error Handling**: Handle connection failures gracefully:
   ```typescript
   try {
     await stagehand.init();
   } catch (error) {
     console.error("Failed to connect to browser server:", error);
   }
   ```

4. **Security**: The WebSocket endpoint allows full browser control. In production:
   - Bind to localhost only (default)
   - Use network isolation
   - Consider adding authentication if exposing to network

## Environment Variables

You can set the browser endpoint via environment variable:

```bash
export BROWSER_ENDPOINT=ws://localhost:9222/...
```

Then in your code:

```typescript
const stagehand = new Stagehand({
  env: "BROWSERSERVER",
  wsEndpoint: process.env.BROWSER_ENDPOINT,
});
```

## Limitations

- All AI features (act, extract, observe, agent) work normally with connected clients
- Each client manages its own pages and contexts
- State synchronization between clients is not automatic - clients are independent
- Browser server must be accessible via network (use localhost for security)

## Troubleshooting

### Connection Refused

If you get "connection refused" errors:
1. Ensure the browser server is running
2. Check that the endpoint URL is correct
3. Verify firewall settings if connecting over network

### Version Mismatch

Playwright checks version compatibility automatically. If you get version errors:
- Ensure all clients use the same Playwright/Stagehand version

### Port Already in Use

If the specified port is taken:
- Omit the `port` option to use a random available port
- Or specify a different port number

## Additional Resources

- [Playwright Browser Server Documentation](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-server)
- [Playwright Connect Documentation](https://playwright.dev/docs/api/class-browsertype#browser-type-connect)
