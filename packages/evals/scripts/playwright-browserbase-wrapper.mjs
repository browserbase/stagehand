#!/usr/bin/env node
/**
 * Playwright MCP + Browserbase wrapper
 *
 * Creates a Browserbase session with stealth/proxy/captcha enabled,
 * then launches playwright-mcp connected to that session.
 *
 * Environment variables:
 *   BROWSERBASE_API_KEY         - Required
 *   BROWSERBASE_PROJECT_ID      - Required
 *   PLAYWRIGHT_MCP_CLI_PATH     - Path to playwright-mcp cli.js
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PLAYWRIGHT_MCP_CLI_PATH = process.env.PLAYWRIGHT_MCP_CLI_PATH;

if (!PLAYWRIGHT_MCP_CLI_PATH) {
  console.error('PLAYWRIGHT_MCP_CLI_PATH environment variable is required');
  process.exit(1);
}

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
  console.error(`[playwright-mcp] Connected to Browserbase session: ${session.sessionId}`);
  console.error(`[playwright-mcp] Debug URL: ${session.debugUrl}`);

  // Launch playwright-mcp with CDP URL
  const playwrightMcp = spawn('node', [PLAYWRIGHT_MCP_CLI_PATH], {
    env: {
      ...process.env,
      PLAYWRIGHT_CDP_URL: session.connectUrl,
    },
    stdio: 'inherit', // Forward stdio to Agent SDK
  });

  playwrightMcp.on('close', (code) => {
    process.exit(code ?? 0);
  });

  // Forward signals
  process.on('SIGTERM', () => playwrightMcp.kill('SIGTERM'));
  process.on('SIGINT', () => playwrightMcp.kill('SIGINT'));
});
