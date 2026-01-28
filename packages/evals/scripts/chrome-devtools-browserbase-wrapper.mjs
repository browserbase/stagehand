#!/usr/bin/env node
/**
 * Chrome DevTools MCP + Browserbase wrapper
 *
 * Connects chrome-devtools-mcp to a pre-created Browserbase session.
 * The session is created by runSkillAgent() before launching this wrapper.
 *
 * Environment variables:
 *   BROWSERBASE_CONNECT_URL      - Required (wss:// URL from pre-created session)
 *   CHROME_DEVTOOLS_MCP_PATH     - Path to chrome-devtools-mcp (optional, defaults to npx)
 *   BROWSERBASE_SESSION_ID       - Optional (for logging)
 *   BROWSERBASE_DEBUG_URL        - Optional (for logging)
 */

import { spawn } from 'child_process';

const BROWSERBASE_CONNECT_URL = process.env.BROWSERBASE_CONNECT_URL;

if (!BROWSERBASE_CONNECT_URL) {
  console.error('BROWSERBASE_CONNECT_URL environment variable is required');
  console.error('The Browserbase session should be created by runSkillAgent() before launching this wrapper');
  process.exit(1);
}

// Log session info to stderr for debugging (Agent SDK will capture this)
if (process.env.BROWSERBASE_SESSION_ID) {
  console.error(`[chrome-devtools-mcp] Using pre-created Browserbase session: ${process.env.BROWSERBASE_SESSION_ID}`);
}
if (process.env.BROWSERBASE_DEBUG_URL) {
  console.error(`[chrome-devtools-mcp] Debug URL: ${process.env.BROWSERBASE_DEBUG_URL}`);
}

// Launch chrome-devtools-mcp with CDP URL pointing to pre-created session
const mcpCommand = process.env.CHROME_DEVTOOLS_MCP_PATH
  ? ['node', process.env.CHROME_DEVTOOLS_MCP_PATH]
  : ['npx', '@modelcontextprotocol/server-chrome-devtools'];

const chromeDevToolsMcp = spawn(mcpCommand[0], mcpCommand.slice(1), {
  env: {
    ...process.env,
    CHROME_CDP_URL: BROWSERBASE_CONNECT_URL,
    CDP_URL: BROWSERBASE_CONNECT_URL, // Some servers use this
  },
  stdio: 'inherit', // Forward stdio to Agent SDK for MCP protocol
});

chromeDevToolsMcp.on('error', (err) => {
  console.error(`[chrome-devtools-mcp] Failed to start: ${err.message}`);
  process.exit(1);
});

chromeDevToolsMcp.on('close', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`[chrome-devtools-mcp] Exited with code ${code}`);
  }
  process.exit(code ?? 0);
});

// Forward signals
process.on('SIGTERM', () => chromeDevToolsMcp.kill('SIGTERM'));
process.on('SIGINT', () => chromeDevToolsMcp.kill('SIGINT'));
