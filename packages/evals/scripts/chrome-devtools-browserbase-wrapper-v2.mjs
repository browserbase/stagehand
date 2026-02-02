#!/usr/bin/env node
/**
 * Chrome DevTools MCP + Browserbase wrapper V2
 *
 * Connects chrome-devtools-mcp to a pre-created Browserbase session.
 * Handles stdio forwarding with proper buffering for MCP handshake.
 *
 * Environment variables:
 *   BROWSERBASE_CONNECT_URL      - Required (wss:// URL from pre-created session)
 *   BROWSERBASE_SESSION_ID       - Optional (for logging)
 *   BROWSERBASE_DEBUG_URL        - Optional (for logging)
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';

const BROWSERBASE_CONNECT_URL = process.env.BROWSERBASE_CONNECT_URL;

if (!BROWSERBASE_CONNECT_URL) {
  console.error('[chrome-devtools-wrapper] ERROR: BROWSERBASE_CONNECT_URL environment variable is required');
  console.error('[chrome-devtools-wrapper] The Browserbase session should be created by runSkillAgent() before launching this wrapper');
  process.exit(1);
}

// Log session info to stderr for debugging (Agent SDK will capture this)
if (process.env.BROWSERBASE_SESSION_ID) {
  console.error(`[chrome-devtools-wrapper] Using pre-created Browserbase session: ${process.env.BROWSERBASE_SESSION_ID}`);
}
if (process.env.BROWSERBASE_DEBUG_URL) {
  console.error(`[chrome-devtools-wrapper] Debug URL: ${process.env.BROWSERBASE_DEBUG_URL}`);
}

// Use npx to run chrome-devtools-mcp (the official package from Google)
console.error(`[chrome-devtools-wrapper] Launching chrome-devtools-mcp via npx chrome-devtools-mcp@latest`);
console.error(`[chrome-devtools-wrapper] WebSocket endpoint: ${BROWSERBASE_CONNECT_URL}`);

// Launch chrome-devtools-mcp with WebSocket endpoint pointing to pre-created session
const chromeDevToolsMcp = spawn('npx', ['-y', 'chrome-devtools-mcp@latest', '--wsEndpoint', BROWSERBASE_CONNECT_URL], {
  env: {
    ...process.env,
  },
  stdio: ['pipe', 'pipe', 'pipe'], // Use pipes instead of inherit for buffering
});

console.error(`[chrome-devtools-wrapper] MCP process spawned with PID: ${chromeDevToolsMcp.pid}`);

// Track if we've received the initialize response
let initializeReceived = false;
let initTimeout = null;

// Forward stdin from Agent SDK to MCP server
process.stdin.pipe(chromeDevToolsMcp.stdin);

// Setup line reader for MCP stdout (JSON-RPC messages)
const stdout = createInterface({
  input: chromeDevToolsMcp.stdout,
  crlfDelay: Infinity,
});

stdout.on('line', (line) => {
  // Forward all JSON-RPC messages to Agent SDK
  console.log(line);

  // Check if this is an initialize response
  try {
    const msg = JSON.parse(line);
    if (msg.result && msg.result.protocolVersion) {
      initializeReceived = true;
      console.error(`[chrome-devtools-wrapper] ✅ MCP initialize handshake successful (protocol version: ${msg.result.protocolVersion})`);
      if (initTimeout) {
        clearTimeout(initTimeout);
        initTimeout = null;
      }
    }
  } catch (e) {
    // Not JSON or not an initialize response, that's OK
  }
});

// Forward stderr from MCP server
chromeDevToolsMcp.stderr.on('data', (data) => {
  const msg = data.toString().trim();
  if (msg) {
    console.error(`[chrome-devtools-mcp] ${msg}`);
  }
});

// Handle MCP process errors
chromeDevToolsMcp.on('error', (err) => {
  console.error(`[chrome-devtools-wrapper] ERROR: Failed to start MCP process: ${err.message}`);
  process.exit(1);
});

// Handle MCP process exit
chromeDevToolsMcp.on('close', (code, signal) => {
  if (code !== 0 && code !== null) {
    console.error(`[chrome-devtools-wrapper] MCP process exited with code ${code}`);
  } else if (signal) {
    console.error(`[chrome-devtools-wrapper] MCP process killed by signal ${signal}`);
  } else {
    console.error(`[chrome-devtools-wrapper] MCP process exited normally`);
  }

  process.exit(code ?? 0);
});

// Set timeout to warn if initialize doesn't happen (but don't exit, let Agent SDK handle timeout)
initTimeout = setTimeout(() => {
  if (!initializeReceived) {
    console.error(`[chrome-devtools-wrapper] ⚠️  WARNING: No initialize response after 10 seconds`);
    console.error(`[chrome-devtools-wrapper] MCP server may still be connecting to CDP...`);
  }
}, 10000);

// Forward signals
process.on('SIGTERM', () => {
  console.error(`[chrome-devtools-wrapper] Received SIGTERM, forwarding to MCP process`);
  chromeDevToolsMcp.kill('SIGTERM');
});
process.on('SIGINT', () => {
  console.error(`[chrome-devtools-wrapper] Received SIGINT, forwarding to MCP process`);
  chromeDevToolsMcp.kill('SIGINT');
});

// Handle our own exit
process.on('exit', (code) => {
  console.error(`[chrome-devtools-wrapper] Wrapper exiting with code ${code}`);
});

console.error(`[chrome-devtools-wrapper] Wrapper initialized, ready for MCP protocol`);
