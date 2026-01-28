/**
 * Claude Agent SDK wrapper for skills comparison
 * Runs different browser automation tools via Agent SDK and collects metrics
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AvailableModel } from "@browserbasehq/stagehand";
import * as path from "path";
import { spawn } from "child_process";

// Use path.resolve to get the directory containing this file
const SCRIPTS_DIR = path.resolve(__dirname, "../scripts");
const HOME = process.env.HOME || process.env.USERPROFILE || "~";

export interface SkillAgentConfig {
  name: string;
  type: "skill" | "mcp";

  // For skills
  cwd?: string;
  settingSources?: Array<"user" | "project">;
  env?: Record<string, string>;
  executable?: "node" | "bun" | "deno";

  // For MCPs
  mcpServers?: Record<string, {
    command: string;
    args: string[];
    env?: Record<string, string>;
  }>;

  allowedTools?: string[];
  model: string;

  // Browserbase session management
  useBrowserbaseSession?: boolean; // If true, creates session with stealth/proxy/captcha
}

export interface AgentMessage {
  type: string;
  subtype?: string;
  num_turns?: number;
  total_cost_usd?: number;
  usage?: any; // Flexible to accommodate different usage types
  result?: string;
  text?: string;
  tool_use?: any;
  tool_result?: any;
  [key: string]: any;
}

export interface SkillAgentMetrics {
  success: boolean;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  turnCount: number;
  reasoning?: string;
  error?: string;
  agentMessages?: AgentMessage[]; // Full turn-by-turn traces from Agent SDK
}

/**
 * Create a Browserbase session with stealth/proxy/captcha enabled
 * Returns session details: { sessionId, connectUrl, debugUrl }
 */
async function createBrowserbaseSession(): Promise<{
  sessionId: string;
  connectUrl: string;
  debugUrl: string;
}> {
  return new Promise((resolve, reject) => {
    const sessionCreator = spawn('node', [
      path.join(SCRIPTS_DIR, 'browserbase-session-creator.mjs'),
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
        reject(new Error(`Failed to create Browserbase session: ${sessionError}`));
        return;
      }

      try {
        const session = JSON.parse(sessionOutput);
        resolve(session);
      } catch (error) {
        reject(new Error(`Failed to parse session output: ${sessionOutput}`));
      }
    });
  });
}

export async function runSkillAgent(
  instruction: string,
  config: SkillAgentConfig
): Promise<SkillAgentMetrics> {
  const startTime = Date.now();
  const metrics: SkillAgentMetrics = {
    success: false,
    totalCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    turnCount: 0,
    agentMessages: [], // Capture all messages for full tracing
  };

  try {
    // Create Browserbase session if needed
    let sessionInfo: { sessionId: string; connectUrl: string; debugUrl: string } | undefined;
    if (config.useBrowserbaseSession) {
      console.log(`[${config.name}] Creating Browserbase session with stealth/proxy/captcha...`);
      sessionInfo = await createBrowserbaseSession();
      console.log(`[${config.name}] Session created: ${sessionInfo.sessionId}`);
      console.log(`[${config.name}] Debug URL: ${sessionInfo.debugUrl}`);
    }

    // Merge session info into env vars
    const env = {
      ...config.env,
      ...(sessionInfo && {
        BROWSERBASE_SESSION_ID: sessionInfo.sessionId,
        BROWSERBASE_CONNECT_URL: sessionInfo.connectUrl,
        BROWSERBASE_DEBUG_URL: sessionInfo.debugUrl,
      }),
    };

    // For MCPs, also merge session info into each MCP server's env
    let mcpServers = config.mcpServers;
    if (mcpServers && sessionInfo) {
      mcpServers = Object.fromEntries(
        Object.entries(mcpServers).map(([name, serverConfig]) => [
          name,
          {
            ...serverConfig,
            env: {
              ...serverConfig.env,
              BROWSERBASE_SESSION_ID: sessionInfo.sessionId,
              BROWSERBASE_CONNECT_URL: sessionInfo.connectUrl,
              BROWSERBASE_DEBUG_URL: sessionInfo.debugUrl,
            },
          },
        ])
      );
    }

    // Debug: Log MCP servers configuration
    if (mcpServers) {
      console.log(`[${config.name}] MCP servers configured:`, JSON.stringify(mcpServers, null, 2));
    }

    console.log(`[${config.name}] Starting Agent SDK query()...`);

    // Build query options based on config type
    const queryOptions: any = {
      model: config.model as AvailableModel,
      allowedTools: config.allowedTools,
      maxBudgetUsd: 5.0,
      maxTurns: 30,
    };

    if (config.type === "mcp") {
      // For MCP servers, only pass mcpServers - no executable/cwd/settingSources
      queryOptions.mcpServers = mcpServers;
    } else {
      // For skills, pass executable, cwd, settingSources, and env
      queryOptions.cwd = config.cwd;
      queryOptions.settingSources = config.settingSources;
      queryOptions.env = env;
      queryOptions.executable = config.executable || "node";
    }

    console.log(`[${config.name}] Query options:`, JSON.stringify(queryOptions, null, 2).substring(0, 500));

    try {
      for await (const message of query({
        prompt: instruction,
        options: queryOptions,
      })) {
      // Capture ALL messages for full turn-by-turn logging
      const timestampedMessage = {
        ...message,
        timestamp: new Date().toISOString(),
      };
      metrics.agentMessages!.push(timestampedMessage);

      // DEBUG: Log all message types
      console.log(`[${config.name}] Message type: ${(message as any).type}, subtype: ${(message as any).subtype || 'N/A'}`);

      // LOG MESSAGES AS THEY ARRIVE for real-time observability
      const msg = message as any; // Agent SDK messages have dynamic types

      // Handle assistant messages (contain text and tool_use blocks)
      if (msg.type === "assistant" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "text") {
            console.log(`[Agent SDK] Assistant: ${block.text.substring(0, 200)}`);
          } else if (block.type === "tool_use") {
            console.log(`[Agent SDK] Tool use: ${block.name}`);
            if (block.input) {
              console.log(`[Agent SDK] Input:`, JSON.stringify(block.input).substring(0, 200));
            }
          }
        }
      }
      // Handle user messages (contain tool_result blocks)
      else if (msg.type === "user" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "tool_result") {
            console.log(`[Agent SDK] Tool result: ${block.tool_use_id}`);
            const content = block.content;
            if (typeof content === 'string') {
              console.log(`[Agent SDK] Result:`, content.substring(0, 200));
            } else if (Array.isArray(content)) {
              for (const item of content) {
                if (item.type === "text") {
                  console.log(`[Agent SDK] Result:`, item.text.substring(0, 200));
                }
              }
            }
          }
        }
      }
      // Handle final result
      else if (msg.type === "result") {
        metrics.durationMs = Date.now() - startTime;
        metrics.turnCount = msg.num_turns;
        metrics.totalCostUsd = msg.total_cost_usd;
        metrics.inputTokens = msg.usage?.input_tokens || 0;
        metrics.outputTokens = msg.usage?.output_tokens || 0;

        if (msg.subtype === "success") {
          metrics.success = true;
          metrics.reasoning = msg.result;
        } else {
          metrics.error = msg.subtype;
        }
      }
    }

    console.log(`[${config.name}] Agent SDK query() loop ended`);
    } catch (queryError) {
      console.error(`[${config.name}] Agent SDK query() threw error:`, queryError);
      throw queryError;
    }
  } catch (error) {
    console.error(`[${config.name}] Outer catch:`, error);
    metrics.error = String(error);
    metrics.durationMs = Date.now() - startTime;
  }

  return metrics;
}

/**
 * Skill configurations for all browser automation tools
 *
 * Setup instructions:
 * - agent-browse: git clone https://github.com/example/agent-browse
 * - dev-browser: git clone https://github.com/example/dev-browser
 * - playwright-mcp: git clone https://github.com/example/playwright-mcp && npm install
 * - playwriter: git clone https://github.com/example/playwriter && npm install
 * - stagehand-cli: Install from shrey/cli branch with execute command:
 *     git clone -b shrey/cli https://github.com/browserbase/stagehand ~/Developer/stagehand-cli
 *     cd ~/Developer/stagehand-cli && pnpm install && pnpm build
 *     Create skills directory at ~/Developer/browserbase-skills with browser-automation skill
 * - agent-browser: git clone https://github.com/vercel-labs/agent-browser && npm install
 */
export const SKILL_CONFIGS: Record<string, SkillAgentConfig> = {
  "agent-browse": {
    name: "agent-browse",
    type: "skill",
    cwd: path.join(HOME, "Developer/agent-browse"),
    settingSources: ["project"],
    allowedTools: ["Bash", "Read", "Glob"],
    model: "claude-sonnet-4-5-20250929",
  },

  "dev-browser": {
    name: "dev-browser",
    type: "skill",
    cwd: path.join(HOME, "Developer/dev-browser"),
    settingSources: ["project"],
    allowedTools: ["Bash", "Read", "Glob"],
    model: "claude-sonnet-4-5-20250929",
  },

  "playwright-mcp": {
    name: "playwright-mcp",
    type: "mcp",
    useBrowserbaseSession: true, // Create session with stealth/proxy/captcha
    mcpServers: {
      playwright: {
        command: "/Users/shrey/.nvm/versions/node/v20.19.5/bin/node",
        args: [path.join(SCRIPTS_DIR, "playwright-browserbase-wrapper-v2.mjs")],
        env: {
          BROWSERBASE_API_KEY: process.env.BROWSERBASE_API_KEY,
          BROWSERBASE_PROJECT_ID: process.env.BROWSERBASE_PROJECT_ID,
          PLAYWRIGHT_MCP_CLI_PATH: path.join(HOME, "Developer/playwright-mcp/cli.js"),
          PATH: process.env.PATH, // Include PATH for subprocess
        }
      }
    },
    allowedTools: ["mcp__playwright__*", "WebFetch", "WebSearch"],
    model: "claude-sonnet-4-5-20250929",
  },

  "playwriter": {
    name: "playwriter",
    type: "mcp",
    mcpServers: {
      playwriter: {
        command: "node",
        args: [path.join(HOME, "Developer/playwriter/playwriter/bin.js")]
      }
    },
    allowedTools: ["mcp__playwriter__*"],
    model: "claude-sonnet-4-5-20250929",
  },

  "stagehand-cli": {
    name: "stagehand-cli",
    type: "skill",
    cwd: path.join(HOME, "Developer/browserbase-skills"),
    settingSources: ["project"],
    env: {
      BROWSERBASE_API_KEY: process.env.BROWSERBASE_API_KEY,
      BROWSERBASE_PROJECT_ID: process.env.BROWSERBASE_PROJECT_ID,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      PATH: process.env.PATH,
    },
    allowedTools: ["Bash", "Read", "Glob", "WebFetch", "WebSearch"],
    model: "claude-sonnet-4-5-20250929",
    useBrowserbaseSession: true, // Create session with stealth/proxy/captcha
  },

  "agent-browser": {
    name: "agent-browser",
    type: "skill",
    cwd: path.join(HOME, "Developer/agent-browser"),
    settingSources: ["project"],
    env: {
      PATH: process.env.PATH,
    },
    allowedTools: ["Bash", "Read", "Glob", "WebFetch", "WebSearch"],
    model: "claude-sonnet-4-5-20250929",
    useBrowserbaseSession: true, // Create session with stealth/proxy/captcha
  },

  "chrome-devtools-mcp": {
    name: "chrome-devtools-mcp",
    type: "mcp",
    useBrowserbaseSession: true, // Create session with stealth/proxy/captcha
    mcpServers: {
      "chrome-devtools": {
        command: "/Users/shrey/.nvm/versions/node/v20.19.5/bin/node",
        args: [path.join(SCRIPTS_DIR, "chrome-devtools-browserbase-wrapper-v2.mjs")],
        env: {
          BROWSERBASE_API_KEY: process.env.BROWSERBASE_API_KEY,
          BROWSERBASE_PROJECT_ID: process.env.BROWSERBASE_PROJECT_ID,
          PATH: process.env.PATH, // Include PATH for subprocess
        }
      }
    },
    allowedTools: ["mcp__chrome-devtools__*", "WebFetch", "WebSearch"],
    model: "claude-sonnet-4-5-20250929",
  },
};
