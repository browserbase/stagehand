/**
 * Claude Agent SDK wrapper for skills comparison
 * Runs different browser automation tools via Agent SDK and collects metrics
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AvailableModel } from "@browserbasehq/stagehand";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import dotenv from "dotenv";

// Load .env from the evals package directory
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// Hardcoded fallback credentials for Browserbase (used if env vars not set)
if (!process.env.BROWSERBASE_API_KEY) {
  process.env.BROWSERBASE_API_KEY = "bb_live_2alz7DCv4wQs9gXjcgaI2YfKGXE";
}
if (!process.env.BROWSERBASE_PROJECT_ID) {
  process.env.BROWSERBASE_PROJECT_ID = "fe1911a7-7576-4cf9-b2ab-e1d9c7dc277b";
}

const HOME = os.homedir();
const SKILLS_DIR = path.join(HOME, "Documents/Browserbase/.agents/skills");
const EVALS_SCRIPTS_DIR = path.resolve(__dirname, "../scripts");

// Base interface for all skill configs
interface BaseSkillConfig {
  name: string;
  description: string;
  model: string;
  useBrowserbase?: boolean; // If true, creates a Browserbase session
}

// CLI-based skill config (uses Bash commands to interact with a CLI tool)
export interface CliSkillConfig extends BaseSkillConfig {
  type: "cli";
  cwd: string;
  allowedTools: string[];
}

// MCP-based skill config (uses MCP server directly)
export interface McpSkillConfig extends BaseSkillConfig {
  type: "mcp";
  mcpServerCommand: string;
  mcpServerArgs?: string[];
  mcpServerEnv?: Record<string, string>;
}

export type SkillAgentConfig = CliSkillConfig | McpSkillConfig;

export interface SkillAgentResult {
  success: boolean;
  error?: string;
  agentMessages: any[];
  metrics: {
    turns: number;
    costUsd: number;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
  };
  browserbaseSessionUrl?: string;
  browserbaseDebugUrl?: string;
}

/**
 * Resolve Claude Code executable path (handles symlinks)
 */
function getClaudeCodePath(): string {
  const symlinkPath = path.join(HOME, ".local", "bin", "claude");
  try {
    return fs.realpathSync(symlinkPath);
  } catch {
    return symlinkPath;
  }
}

interface BrowserbaseSession {
  id: string;
  connectUrl: string;
  debugUrl: string;
}

/**
 * Create a Browserbase session with stealth/proxy/captcha settings
 */
async function createBrowserbaseSession(): Promise<BrowserbaseSession> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;

  if (!apiKey || !projectId) {
    throw new Error("BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID are required");
  }

  const response = await fetch("https://api.browserbase.com/v1/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bb-api-key": apiKey,
    },
    body: JSON.stringify({
      projectId,
      browserSettings: {
        advancedStealth: true,
        solveCaptchas: true,
        blockAds: true,
      },
      proxies: true,
      keepAlive: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create Browserbase session: ${response.status} ${text}`);
  }

  const data = await response.json() as { id: string; connectUrl: string };
  const sessionId = data.id;
  const connectUrl = data.connectUrl;
  const debugUrl = `https://www.browserbase.com/sessions/${sessionId}`;

  console.log(`[browserbase] Session created: ${sessionId}`);
  console.log(`[browserbase] Debug URL: ${debugUrl}`);

  return { id: sessionId, connectUrl, debugUrl };
}

/**
 * Close a Browserbase session
 */
async function closeBrowserbaseSession(sessionId: string): Promise<void> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;

  if (!apiKey || !projectId) return;

  try {
    await fetch(`https://api.browserbase.com/v1/sessions/${sessionId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bb-api-key": apiKey,
      },
      body: JSON.stringify({
        projectId,
        status: "REQUEST_RELEASE",
      }),
    });
    console.log(`[browserbase] Session closed: ${sessionId}`);
  } catch (error) {
    console.error(`[browserbase] Failed to close session: ${error}`);
  }
}

/**
 * Available skill configurations
 */
export const SKILL_CONFIGS: Record<string, SkillAgentConfig> = {
  // CLI-based skills (use Bash commands)
  "agent-browser": {
    type: "cli",
    name: "agent-browser",
    description: "Browser automation using agent-browser CLI (local)",
    cwd: path.join(SKILLS_DIR, "agent-browser"),
    allowedTools: ["Bash", "Read", "Glob"],
    model: "claude-sonnet-4-5-20250929",
    useBrowserbase: false, // Uses local Playwright
  },

  "browse": {
    type: "cli",
    name: "browse",
    description: "Browser automation using browse CLI (Browserbase)",
    cwd: path.join(SKILLS_DIR, "browse"),
    allowedTools: ["Bash", "Read", "Glob"],
    model: "claude-sonnet-4-5-20250929",
    useBrowserbase: false, // Browse CLI is designed for Browserbase
  },

  "dev-browser": {
    type: "cli",
    name: "dev-browser",
    description: "Browser automation using dev-browser",
    cwd: path.join(SKILLS_DIR, "dev-browser"),
    allowedTools: ["Bash", "Read", "Glob"],
    model: "claude-sonnet-4-5-20250929",
    useBrowserbase: false,
  },

  "playwriter": {
    type: "cli",
    name: "playwriter",
    description: "Browser automation using playwriter MCP",
    cwd: path.join(SKILLS_DIR, "playwriter"),
    allowedTools: ["Bash", "Read", "Glob"],
    model: "claude-sonnet-4-5-20250929",
    useBrowserbase: false,
  },

  // MCP-based skills (use MCP servers directly)
  "playwright-mcp": {
    type: "mcp",
    name: "playwright-mcp",
    description: "Browser automation using Playwright MCP server with Browserbase",
    model: "claude-sonnet-4-5-20250929",
    useBrowserbase: true,
    mcpServerCommand: "node",
    mcpServerArgs: [path.join(EVALS_SCRIPTS_DIR, "playwright-browserbase-wrapper-v2.mjs")],
  },

  "chrome-devtools-mcp": {
    type: "mcp",
    name: "chrome-devtools-mcp",
    description: "Browser automation using Chrome DevTools MCP server with Browserbase",
    model: "claude-sonnet-4-5-20250929",
    useBrowserbase: true,
    mcpServerCommand: "node",
    mcpServerArgs: [path.join(EVALS_SCRIPTS_DIR, "chrome-devtools-browserbase-wrapper-v2.mjs")],
  },
};

/**
 * Run a skill agent with the given instruction
 */
export async function runSkillAgent(
  skillName: string,
  instruction: string,
  options?: {
    maxTurns?: number;
    maxBudgetUsd?: number;
    startUrl?: string;
  }
): Promise<SkillAgentResult> {
  const config = SKILL_CONFIGS[skillName];
  if (!config) {
    return {
      success: false,
      error: `Unknown skill: ${skillName}`,
      agentMessages: [],
      metrics: { turns: 0, costUsd: 0, durationMs: 0, inputTokens: 0, outputTokens: 0 },
    };
  }

  // For CLI-based skills, verify cwd exists
  if (config.type === "cli" && !fs.existsSync(config.cwd)) {
    return {
      success: false,
      error: `Skill directory does not exist: ${config.cwd}`,
      agentMessages: [],
      metrics: { turns: 0, costUsd: 0, durationMs: 0, inputTokens: 0, outputTokens: 0 },
    };
  }

  const claudeCodePath = getClaudeCodePath();
  const startTime = Date.now();
  const agentMessages: any[] = [];
  let browserbaseSession: BrowserbaseSession | null = null;

  // Create Browserbase session if needed
  if (config.useBrowserbase) {
    try {
      browserbaseSession = await createBrowserbaseSession();
    } catch (error) {
      return {
        success: false,
        error: `Failed to create Browserbase session: ${error}`,
        agentMessages: [],
        metrics: { turns: 0, costUsd: 0, durationMs: 0, inputTokens: 0, outputTokens: 0 },
      };
    }
  }

  // Build the prompt with optional start URL
  let prompt = instruction;
  if (options?.startUrl) {
    prompt = `Start by navigating to ${options.startUrl}, then: ${instruction}`;
  }

  console.log(`[${skillName}] Starting Agent SDK query...`);
  console.log(`[${skillName}] Skill type: ${config.type}`);
  if (config.type === "cli") {
    console.log(`[${skillName}] CWD: ${config.cwd}`);
  }
  console.log(`[${skillName}] Claude Code: ${claudeCodePath}`);
  if (browserbaseSession) {
    console.log(`[${skillName}] Browserbase session: ${browserbaseSession.id}`);
    console.log(`[${skillName}] Debug URL: ${browserbaseSession.debugUrl}`);
  }

  // Build environment with Browserbase session info
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
  };
  if (browserbaseSession) {
    env.BROWSERBASE_SESSION_ID = browserbaseSession.id;
    env.BROWSERBASE_CONNECT_URL = browserbaseSession.connectUrl;
    env.AGENT_BROWSER_PROVIDER = "browserbase";
  }

  // Build query options based on skill type
  let queryOptions: any;

  if (config.type === "mcp") {
    // MCP-based skill: configure MCP server
    const mcpServerName = config.name;
    const mcpEnv: Record<string, string> = {
      ...env,
      ...(config.mcpServerEnv || {}),
    };

    // Add path to playwright-mcp CLI if needed
    if (skillName === "playwright-mcp") {
      // Try to find playwright-mcp in common locations
      const playwrightMcpPath = path.join(
        HOME,
        "Documents/Browserbase/playwright-mcp/dist/cli.js"
      );
      if (fs.existsSync(playwrightMcpPath)) {
        mcpEnv.PLAYWRIGHT_MCP_CLI_PATH = playwrightMcpPath;
      }
    }

    const systemPrompt = `You are a browser automation agent with access to MCP (Model Context Protocol) tools for browser control.

You have access to browser automation tools provided by the "${mcpServerName}" MCP server. Use these tools to complete web automation tasks.

IMPORTANT:
- You do NOT have access to WebFetch, WebSearch, or any other web tools. Do not attempt to use them.
- Use the MCP tools (prefixed with mcp__${mcpServerName.replace(/-/g, "_")}__) to interact with the browser.
- The browser is already connected to a cloud session - you don't need to launch or connect to a browser.
- Start by navigating to the target URL, then complete the task step by step.`;

    queryOptions = {
      model: config.model as AvailableModel,
      disallowedTools: ["WebFetch", "WebSearch", "Task"],
      systemPrompt,
      env,
      maxTurns: options?.maxTurns ?? 20,
      maxBudgetUsd: options?.maxBudgetUsd ?? 2.0,
      pathToClaudeCodeExecutable: claudeCodePath,
      mcpServers: {
        [mcpServerName]: {
          type: "stdio" as const,
          command: config.mcpServerCommand,
          args: config.mcpServerArgs || [],
          env: mcpEnv,
        },
      },
    };

    console.log(`[${skillName}] MCP server: ${mcpServerName}`);
    console.log(`[${skillName}] MCP command: ${config.mcpServerCommand} ${(config.mcpServerArgs || []).join(" ")}`);
  } else {
    // CLI-based skill: use Bash commands
    let systemPrompt = `You are a browser automation agent. You ONLY have access to Bash, Read, and Glob tools.

IMPORTANT: You do NOT have access to WebFetch, WebSearch, or any web tools. Do not attempt to use them - they will be denied.

To complete browser automation tasks, you must use the browser automation CLI tool available via Bash commands.
Read the SKILL.md file in your current directory to learn how to use the browser automation tool.

Your workflow should be:
1. First, read the SKILL.md file to understand the available commands
2. Use Bash to run browser automation commands (like opening URLs, taking snapshots, clicking elements)
3. Complete the task using only Bash commands`;

    // Add skill-specific instruction to connect to Browserbase session if one was created
    if (browserbaseSession) {
      let connectionInstructions = "";

      switch (skillName) {
        case "agent-browser":
          connectionInstructions = `Before running any browser commands, you MUST first connect to the cloud browser:
  agent-browser connect "${browserbaseSession.connectUrl}"
After connecting, run your browser automation commands normally.`;
          break;

        case "dev-browser":
          connectionInstructions = `Connect to the cloud browser using the CDP URL:
  Environment variable BROWSERBASE_CONNECT_URL is set to the WebSocket URL.
  Use this URL to connect via CDP.`;
          break;

        case "playwriter":
          connectionInstructions = `A Browserbase session is available. Connect using the CDP endpoint:
  ${browserbaseSession.connectUrl}`;
          break;

        default:
          connectionInstructions = `A cloud browser session is available at:
  ${browserbaseSession.connectUrl}
Connect to this session before running browser commands.`;
      }

      systemPrompt += `

IMPORTANT - BROWSER CONNECTION:
${connectionInstructions}`;
    }

    queryOptions = {
      model: config.model as AvailableModel,
      allowedTools: config.allowedTools,
      disallowedTools: ["WebFetch", "WebSearch", "Task"],
      systemPrompt,
      env,
      maxTurns: options?.maxTurns ?? 20,
      maxBudgetUsd: options?.maxBudgetUsd ?? 2.0,
      cwd: config.cwd,
      pathToClaudeCodeExecutable: claudeCodePath,
    };
  }

  try {
    let turns = 0;
    let costUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let isError = false;

    for await (const message of query({
      prompt,
      options: queryOptions,
    })) {
      agentMessages.push({
        ...message,
        timestamp: new Date().toISOString(),
      });

      // Log progress with detailed traces
      if (message.type === "assistant") {
        const content = (message as any).message?.content;
        if (content) {
          for (const block of content) {
            if (block.type === "text") {
              console.log(`[${skillName}] Assistant: ${block.text.substring(0, 200)}...`);
            } else if (block.type === "tool_use") {
              console.log(`[${skillName}] Tool: ${block.name} - ${JSON.stringify(block.input).substring(0, 150)}`);
            }
          }
        }
      } else if (message.type === "user") {
        const content = (message as any).message?.content;
        if (content) {
          for (const block of content) {
            if (block.type === "tool_result") {
              const resultStr = typeof block.content === "string"
                ? block.content.substring(0, 200)
                : JSON.stringify(block.content).substring(0, 200);
              console.log(`[${skillName}] Tool Result: ${resultStr}...`);
            }
          }
        }
      } else if (message.type === "result") {
        turns = (message as any).num_turns ?? 0;
        costUsd = (message as any).cost_usd ?? 0;
        inputTokens = (message as any).input_tokens ?? 0;
        outputTokens = (message as any).output_tokens ?? 0;
        isError = (message as any).is_error ?? false;
        console.log(`[${skillName}] === COMPLETED ===`);
        console.log(`[${skillName}] Turns: ${turns}, Cost: $${costUsd.toFixed(4)}`);
        console.log(`[${skillName}] Tokens: ${inputTokens} in / ${outputTokens} out`);
        console.log(`[${skillName}] Success: ${!isError}`);
      }
    }

    const durationMs = Date.now() - startTime;

    // Cleanup Browserbase session
    if (browserbaseSession) {
      await closeBrowserbaseSession(browserbaseSession.id);
    }

    return {
      success: !isError,
      agentMessages,
      metrics: {
        turns,
        costUsd,
        durationMs,
        inputTokens,
        outputTokens,
      },
      browserbaseSessionUrl: browserbaseSession ? `https://www.browserbase.com/sessions/${browserbaseSession.id}` : undefined,
      browserbaseDebugUrl: browserbaseSession?.debugUrl,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error(`[${skillName}] Error:`, error);

    // Cleanup Browserbase session on error
    if (browserbaseSession) {
      await closeBrowserbaseSession(browserbaseSession.id);
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      agentMessages,
      metrics: {
        turns: 0,
        costUsd: 0,
        durationMs,
        inputTokens: 0,
        outputTokens: 0,
      },
      browserbaseSessionUrl: browserbaseSession ? `https://www.browserbase.com/sessions/${browserbaseSession.id}` : undefined,
      browserbaseDebugUrl: browserbaseSession?.debugUrl,
    };
  }
}

/**
 * Get list of available skill names
 */
export function getAvailableSkills(): string[] {
  return Object.keys(SKILL_CONFIGS);
}
