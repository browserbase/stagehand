#!/usr/bin/env node
/**
 * Playwright MCP + Browserbase wrapper
 *
 * Connects playwright-mcp to a pre-created Browserbase session.
 * The session is created by runSkillAgent() before launching this wrapper.
 *
 * Environment variables:
 *   BROWSERBASE_CONNECT_URL     - Required (wss:// URL from pre-created session)
 *   PLAYWRIGHT_MCP_CLI_PATH     - Path to playwright-mcp cli.js
 *   BROWSERBASE_SESSION_ID      - Optional (for logging)
 *   BROWSERBASE_DEBUG_URL       - Optional (for logging)
 */

import { spawn } from 'child_process';

const PLAYWRIGHT_MCP_CLI_PATH = process.env.PLAYWRIGHT_MCP_CLI_PATH;
const BROWSERBASE_CONNECT_URL = process.env.BROWSERBASE_CONNECT_URL;

if (!PLAYWRIGHT_MCP_CLI_PATH) {
  console.error('PLAYWRIGHT_MCP_CLI_PATH environment variable is required');
  process.exit(1);
}

if (!BROWSERBASE_CONNECT_URL) {
  console.error('BROWSERBASE_CONNECT_URL environment variable is required');
  console.error('The Browserbase session should be created by runSkillAgent() before launching this wrapper');
  process.exit(1);
}

// Log session info to stderr for debugging (Agent SDK will capture this)
if (process.env.BROWSERBASE_SESSION_ID) {
  console.error(`[playwright-mcp] Using pre-created Browserbase session: ${process.env.BROWSERBASE_SESSION_ID}`);
}
if (process.env.BROWSERBASE_DEBUG_URL) {
  console.error(`[playwright-mcp] Debug URL: ${process.env.BROWSERBASE_DEBUG_URL}`);
}

// Launch playwright-mcp with CDP URL pointing to pre-created session
const playwrightMcp = spawn('node', [PLAYWRIGHT_MCP_CLI_PATH], {
  env: {
    ...process.env,
    PLAYWRIGHT_CDP_URL: BROWSERBASE_CONNECT_URL,
  },
  stdio: 'inherit', // Forward stdio to Agent SDK for MCP protocol
});

playwrightMcp.on('error', (err) => {
  console.error(`[playwright-mcp] Failed to start: ${err.message}`);
  process.exit(1);
});

playwrightMcp.on('close', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`[playwright-mcp] Exited with code ${code}`);
  }
  process.exit(code ?? 0);
});

// Forward signals
process.on('SIGTERM', () => playwrightMcp.kill('SIGTERM'));
process.on('SIGINT', () => playwrightMcp.kill('SIGINT'));
