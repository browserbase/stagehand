#!/usr/bin/env node
/**
 * Playwright MCP + Browserbase wrapper V2
 *
 * Connects playwright-mcp to a pre-created Browserbase session.
 * Handles stdio forwarding with proper buffering for MCP handshake.
 *
 * Environment variables:
 *   BROWSERBASE_CONNECT_URL     - Required (wss:// URL from pre-created session)
 *   PLAYWRIGHT_MCP_CLI_PATH     - Path to playwright-mcp cli.js
 *   BROWSERBASE_SESSION_ID      - Optional (for logging)
 *   BROWSERBASE_DEBUG_URL       - Optional (for logging)
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';

const PLAYWRIGHT_MCP_CLI_PATH = process.env.PLAYWRIGHT_MCP_CLI_PATH;
const BROWSERBASE_CONNECT_URL = process.env.BROWSERBASE_CONNECT_URL;

if (!PLAYWRIGHT_MCP_CLI_PATH) {
  console.error('[playwright-wrapper] ERROR: PLAYWRIGHT_MCP_CLI_PATH environment variable is required');
  process.exit(1);
}

if (!BROWSERBASE_CONNECT_URL) {
  console.error('[playwright-wrapper] ERROR: BROWSERBASE_CONNECT_URL environment variable is required');
  console.error('[playwright-wrapper] The Browserbase session should be created by runSkillAgent() before launching this wrapper');
  process.exit(1);
}

// Log session info to stderr for debugging (Agent SDK will capture this)
if (process.env.BROWSERBASE_SESSION_ID) {
  console.error(`[playwright-wrapper] Using pre-created Browserbase session: ${process.env.BROWSERBASE_SESSION_ID}`);
}
if (process.env.BROWSERBASE_DEBUG_URL) {
  console.error(`[playwright-wrapper] Debug URL: ${process.env.BROWSERBASE_DEBUG_URL}`);
}

console.error(`[playwright-wrapper] Launching playwright-mcp CLI: ${PLAYWRIGHT_MCP_CLI_PATH}`);

// Launch playwright-mcp with CDP URL pointing to pre-created session
const playwrightMcp = spawn(process.execPath, [PLAYWRIGHT_MCP_CLI_PATH, '--cdp-endpoint', BROWSERBASE_CONNECT_URL], {
  env: {
    ...process.env,
  },
  stdio: ['pipe', 'pipe', 'pipe'], // Use pipes instead of inherit for buffering
});

console.error(`[playwright-wrapper] MCP process spawned with PID: ${playwrightMcp.pid}`);

// Track if we've received the initialize response
let initializeReceived = false;
let initTimeout = null;

// Forward stdin from Agent SDK to MCP server
process.stdin.pipe(playwrightMcp.stdin);

// Setup line reader for MCP stdout (JSON-RPC messages)
const stdout = createInterface({
  input: playwrightMcp.stdout,
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
      console.error(`[playwright-wrapper] ✅ MCP initialize handshake successful (protocol version: ${msg.result.protocolVersion})`);
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
playwrightMcp.stderr.on('data', (data) => {
  const msg = data.toString().trim();
  if (msg) {
    console.error(`[playwright-mcp] ${msg}`);
  }
});

// Handle MCP process errors
playwrightMcp.on('error', (err) => {
  console.error(`[playwright-wrapper] ERROR: Failed to start MCP process: ${err.message}`);
  process.exit(1);
});

// Handle MCP process exit
playwrightMcp.on('close', (code, signal) => {
  if (code !== 0 && code !== null) {
    console.error(`[playwright-wrapper] MCP process exited with code ${code}`);
  } else if (signal) {
    console.error(`[playwright-wrapper] MCP process killed by signal ${signal}`);
  } else {
    console.error(`[playwright-wrapper] MCP process exited normally`);
  }

  process.exit(code ?? 0);
});

// Set timeout to warn if initialize doesn't happen (but don't exit, let Agent SDK handle timeout)
initTimeout = setTimeout(() => {
  if (!initializeReceived) {
    console.error(`[playwright-wrapper] ⚠️  WARNING: No initialize response after 10 seconds`);
    console.error(`[playwright-wrapper] MCP server may still be connecting to CDP...`);
  }
}, 10000);

// Forward signals
process.on('SIGTERM', () => {
  console.error(`[playwright-wrapper] Received SIGTERM, forwarding to MCP process`);
  playwrightMcp.kill('SIGTERM');
});
process.on('SIGINT', () => {
  console.error(`[playwright-wrapper] Received SIGINT, forwarding to MCP process`);
  playwrightMcp.kill('SIGINT');
});

// Handle our own exit
process.on('exit', (code) => {
  console.error(`[playwright-wrapper] Wrapper exiting with code ${code}`);
});

console.error(`[playwright-wrapper] Wrapper initialized, ready for MCP protocol`);
