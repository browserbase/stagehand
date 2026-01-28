#!/usr/bin/env node
/**
 * Chrome DevTools MCP + Browserbase wrapper
 *
 * Creates a Browserbase session with stealth/proxy/captcha enabled,
 * then launches chrome-devtools-mcp connected to that session.
 *
 * Environment variables:
 *   BROWSERBASE_API_KEY          - Required
 *   BROWSERBASE_PROJECT_ID       - Required
 *   CHROME_DEVTOOLS_MCP_PATH     - Path to chrome-devtools-mcp (optional, defaults to npx)
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create Browserbase session
const sessionCreator = spawn('node', [
  resolve(__dirname, 'browserbase-session-creator.mjs'),
], {
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let sessionOutput = '';
let sessionError = '';

sessionCreator.stdout.on('data', (data) => {
  sessionOutput += data.toString();
});

sessionCreator.stderr.on('data', (data) => {
  sessionError += data.toString();
});

sessionCreator.on('close', (code) => {
  if (code !== 0) {
    console.error('Failed to create Browserbase session:', sessionError);
    process.exit(1);
  }

  let session;
  try {
    session = JSON.parse(sessionOutput);
  } catch (error) {
    console.error('Failed to parse session output:', sessionOutput);
    process.exit(1);
  }

  // Log session info to stderr for debugging (Agent SDK will capture this)
  console.error(`[chrome-devtools-mcp] Connected to Browserbase session: ${session.sessionId}`);
  console.error(`[chrome-devtools-mcp] Debug URL: ${session.debugUrl}`);

  // Launch chrome-devtools-mcp with CDP URL
  const mcpCommand = process.env.CHROME_DEVTOOLS_MCP_PATH
    ? ['node', process.env.CHROME_DEVTOOLS_MCP_PATH]
    : ['npx', '@modelcontextprotocol/server-chrome-devtools'];

  const chromeDevToolsMcp = spawn(mcpCommand[0], mcpCommand.slice(1), {
    env: {
      ...process.env,
      CHROME_CDP_URL: session.connectUrl,
      CDP_URL: session.connectUrl, // Some servers use this
    },
    stdio: 'inherit', // Forward stdio to Agent SDK
  });

  chromeDevToolsMcp.on('close', (code) => {
    process.exit(code ?? 0);
  });

  // Forward signals
  process.on('SIGTERM', () => chromeDevToolsMcp.kill('SIGTERM'));
  process.on('SIGINT', () => chromeDevToolsMcp.kill('SIGINT'));
});
