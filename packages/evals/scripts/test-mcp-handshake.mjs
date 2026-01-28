#!/usr/bin/env node
/**
 * Test MCP handshake with pre-created Browserbase session
 *
 * This script tests if MCP servers can successfully:
 * 1. Connect to a pre-created Browserbase session
 * 2. Complete the MCP initialize handshake
 * 3. Respond to tool list requests
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test configuration
const TEST_CONFIG = {
  playwright: {
    wrapper: join(__dirname, 'playwright-browserbase-wrapper-v2.mjs'),
    name: 'playwright-mcp',
  },
  'chrome-devtools': {
    wrapper: join(__dirname, 'chrome-devtools-browserbase-wrapper.mjs'),
    name: 'chrome-devtools-mcp',
  },
};

/**
 * Create a Browserbase session
 */
async function createSession() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [join(__dirname, 'browserbase-session-creator.mjs')], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let errors = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.stderr.on('data', (data) => {
      errors += data.toString();
      console.error('[Session Creator]', data.toString().trim());
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Failed to create session: ${errors}`));
        return;
      }

      try {
        const session = JSON.parse(output);
        console.log(`\n✅ Session created: ${session.sessionId}`);
        console.log(`   Debug URL: ${session.debugUrl}\n`);
        resolve(session);
      } catch (err) {
        reject(new Error(`Failed to parse session: ${output}`));
      }
    });
  });
}

/**
 * Send MCP initialize request and wait for response
 */
function testMCPHandshake(mcpProcess, timeout = 30000) {
  return new Promise((resolve, reject) => {
    let responseBuffer = '';
    let initializeReceived = false;
    let toolsReceived = false;

    const timer = setTimeout(() => {
      if (!initializeReceived) {
        reject(new Error('Timeout waiting for initialize response'));
      } else if (!toolsReceived) {
        reject(new Error('Initialize succeeded but no tools/list response'));
      }
    }, timeout);

    // Listen for MCP responses on stdout
    mcpProcess.stdout.on('data', (data) => {
      const text = data.toString();
      responseBuffer += text;

      // Parse JSON-RPC messages (one per line)
      const lines = responseBuffer.split('\n');
      responseBuffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const msg = JSON.parse(line);
          console.log('[MCP Response]', JSON.stringify(msg, null, 2));

          // Check for initialize response
          if (msg.result && msg.result.protocolVersion) {
            console.log('✅ Initialize handshake successful');
            initializeReceived = true;
          }

          // Check for tools/list response
          if (msg.result && Array.isArray(msg.result.tools)) {
            console.log(`✅ Tools list received: ${msg.result.tools.length} tools`);
            toolsReceived = true;
            clearTimeout(timer);
            resolve({ initializeReceived, toolsReceived, tools: msg.result.tools });
          }
        } catch (err) {
          // Not JSON or incomplete message
          console.log('[MCP Output]', line);
        }
      }
    });

    mcpProcess.stderr.on('data', (data) => {
      console.error('[MCP Error]', data.toString().trim());
    });

    mcpProcess.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Process error: ${err.message}`));
    });

    mcpProcess.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Process exited with code ${code}`));
      } else if (!initializeReceived) {
        reject(new Error('Process closed before initialize'));
      } else if (!toolsReceived) {
        reject(new Error('Process closed before tools/list'));
      }
    });

    // Send MCP initialize request
    console.log('[MCP] Sending initialize request...');
    const initRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        clientInfo: {
          name: 'test-mcp-handshake',
          version: '1.0.0',
        },
      },
    };
    mcpProcess.stdin.write(JSON.stringify(initRequest) + '\n');

    // Wait a bit for initialize to complete, then request tools
    setTimeout(() => {
      if (initializeReceived) {
        console.log('[MCP] Sending initialized notification...');
        const initNotification = {
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        };
        mcpProcess.stdin.write(JSON.stringify(initNotification) + '\n');

        console.log('[MCP] Sending tools/list request...');
        const toolsRequest = {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
        };
        mcpProcess.stdin.write(JSON.stringify(toolsRequest) + '\n');
      }
    }, 2000);
  });
}

/**
 * Test a specific MCP server
 */
async function testMCP(mcpType, session) {
  const config = TEST_CONFIG[mcpType];
  if (!config) {
    throw new Error(`Unknown MCP type: ${mcpType}`);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${config.name}`);
  console.log('='.repeat(60));

  const env = {
    ...process.env,
    BROWSERBASE_SESSION_ID: session.sessionId,
    BROWSERBASE_CONNECT_URL: session.connectUrl,
    BROWSERBASE_DEBUG_URL: session.debugUrl,
    PLAYWRIGHT_MCP_CLI_PATH: join(process.env.HOME, 'Developer/playwright-mcp/cli.js'),
    CHROME_DEVTOOLS_MCP_PATH: join(process.env.HOME, 'Developer/chrome-devtools-mcp/build/src/index.js'),
  };

  console.log(`[${config.name}] Launching wrapper...`);
  const proc = spawn('node', [config.wrapper], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  try {
    const result = await testMCPHandshake(proc);
    console.log(`\n✅ ${config.name} handshake successful!`);
    console.log(`   Tools available: ${result.tools.length}`);
    return { success: true, ...result };
  } catch (err) {
    console.error(`\n❌ ${config.name} handshake failed: ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    proc.kill();
  }
}

/**
 * Main test runner
 */
async function main() {
  const mcpType = process.argv[2] || 'playwright';

  console.log('MCP Handshake Test');
  console.log('==================\n');
  console.log(`Testing: ${mcpType}`);
  console.log(`Timeout: 30 seconds\n`);

  try {
    // Step 1: Create Browserbase session
    console.log('Step 1: Creating Browserbase session...');
    const session = await createSession();

    // Step 2: Test MCP handshake
    console.log('Step 2: Testing MCP handshake...');
    const result = await testMCP(mcpType, session);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('Test Summary');
    console.log('='.repeat(60));
    console.log(`Status: ${result.success ? '✅ PASS' : '❌ FAIL'}`);
    if (result.error) {
      console.log(`Error: ${result.error}`);
    }
    console.log('='.repeat(60));

    process.exit(result.success ? 0 : 1);
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
