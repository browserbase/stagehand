/**
 * Claude Agent SDK wrapper for skills comparison
 * Runs different browser automation tools via Agent SDK and collects metrics
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AvailableModel } from "@browserbasehq/stagehand";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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
  };

  try {
    for await (const message of query({
      prompt: instruction,
      options: {
        mcpServers: config.mcpServers,
        cwd: config.cwd,
        settingSources: config.settingSources,
        env: config.env,
        executable: config.executable || "node",
        allowedTools: config.allowedTools,
        model: config.model as AvailableModel,
        maxBudgetUsd: 5.0,
        maxTurns: 30,
      }
    })) {
      if (message.type === "result") {
        metrics.durationMs = Date.now() - startTime;
        metrics.turnCount = message.num_turns;
        metrics.totalCostUsd = message.total_cost_usd;
        metrics.inputTokens = message.usage?.input_tokens || 0;
        metrics.outputTokens = message.usage?.output_tokens || 0;

        if (message.subtype === "success") {
          metrics.success = true;
          metrics.reasoning = message.result;
        } else {
          metrics.error = message.subtype;
        }
      }
    }
  } catch (error) {
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
    mcpServers: {
      playwright: {
        command: "node",
        args: [path.resolve(__dirname, "../scripts/playwright-browserbase-wrapper.mjs")],
        env: {
          BROWSERBASE_API_KEY: process.env.BROWSERBASE_API_KEY,
          BROWSERBASE_PROJECT_ID: process.env.BROWSERBASE_PROJECT_ID,
          PLAYWRIGHT_MCP_CLI_PATH: path.join(HOME, "Developer/playwright-mcp/cli.js")
        }
      }
    },
    allowedTools: ["mcp__playwright__*"],
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
    allowedTools: ["Bash", "Read", "Glob"],
    model: "claude-sonnet-4-5-20250929",
  },

  "agent-browser": {
    name: "agent-browser",
    type: "skill",
    cwd: path.join(HOME, "Developer/agent-browser"),
    settingSources: ["project"],
    env: {
      AGENT_BROWSER_PROVIDER: "browserbase",
      BROWSERBASE_API_KEY: process.env.BROWSERBASE_API_KEY,
      BROWSERBASE_PROJECT_ID: process.env.BROWSERBASE_PROJECT_ID,
      PATH: process.env.PATH,
    },
    allowedTools: ["Bash", "Read", "Glob"],
    model: "claude-sonnet-4-5-20250929",
  },

  "chrome-devtools-mcp": {
    name: "chrome-devtools-mcp",
    type: "mcp",
    mcpServers: {
      "chrome-devtools": {
        command: "node",
        args: [path.resolve(__dirname, "../scripts/chrome-devtools-browserbase-wrapper.mjs")],
        env: {
          BROWSERBASE_API_KEY: process.env.BROWSERBASE_API_KEY,
          BROWSERBASE_PROJECT_ID: process.env.BROWSERBASE_PROJECT_ID,
        }
      }
    },
    allowedTools: ["mcp__chrome-devtools__*"],
    model: "claude-sonnet-4-5-20250929",
  },
};
