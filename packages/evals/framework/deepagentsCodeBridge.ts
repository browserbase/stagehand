/**
 * Code-execution bridge for the deepagents harness.
 *
 * Deep Agents has the same out-of-process problem codex does: a `via: "handles"`
 * mount is a set of live in-process objects (the Stagehand client, a Playwright
 * page), so the snippet must execute here while the agent that wrote it runs
 * elsewhere. codex solves it with a loopback HTTP bridge plus a workspace
 * client script its shell invokes; the Deep Agents runner has no shell, so the
 * same executor is fronted by the harness's MCP run tool instead.
 *
 * Scope semantics are the shared ones in `codeExposure.ts`: the snippet runs
 * inside an async function whose arguments are the mount's handle names plus
 * startUrl, task, and console — names, not order, bind values.
 */
import { z } from "zod/v4";
import {
  AGENT_RUN_TOOL_NAME,
  AGENT_RUN_TOOL_SERVER,
  type AgentMount,
} from "../core/contracts/tool.js";
import type { EvalLogger } from "../logger.js";
import { clipToolResult, executeCodeExposureSnippet, stringifyToolResult } from "./codeExposure.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { startMcpLoopbackBridge, type McpLoopbackBridge } from "./mcpLoopbackBridge.js";

/** MCP server carrying the run tool; shared with the other handle harnesses. */
export const DEEPAGENTS_RUN_TOOL_SERVER = AGENT_RUN_TOOL_SERVER;

/**
 * Tool name as langchain-mcp-adapters reports it. Unlike claude-agent-sdk it
 * does not prefix the server, so the agent sees a bare `run` and the trajectory
 * records `stagehand_browser.run`.
 */
export const DEEPAGENTS_RUN_TOOL_NAME = "run";

export type DeepagentsCodeBridge = McpLoopbackBridge;

export async function startDeepagentsCodeBridge(input: {
  mount: Extract<AgentMount, { via: "handles" }>;
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
  /** Awaited after every run, success or failure (per-step probe). */
  onRunExecuted?: () => Promise<void>;
}): Promise<DeepagentsCodeBridge> {
  return startMcpLoopbackBridge({
    serverName: "stagehand-evals-deepagents-run",
    logger: input.logger,
    logCategory: "deepagents",
    register: (server) => {
      server.registerTool(
        DEEPAGENTS_RUN_TOOL_NAME,
        {
          description: input.mount.runTool.description,
          inputSchema: {
            code: z.string().describe(input.mount.runTool.codeParamDescription),
          },
        },
        ({ code }) => executeRunTool(code, input),
      );
    },
  });
}

/**
 * Rewrites a mount's prompt instructions for Deep Agents' tool naming.
 *
 * Surfaces describe the run tool by its claude-agent-sdk name
 * (`mcp__stagehand_browser__run`); the Deep Agents agent only ever sees `run`.
 * Mastra rewrites the same way for the same reason.
 */
export function rewriteRunToolInstructions(promptInstructions: string): string {
  return promptInstructions.replaceAll(AGENT_RUN_TOOL_NAME, DEEPAGENTS_RUN_TOOL_NAME);
}

async function executeRunTool(
  code: string,
  input: {
    mount: Extract<AgentMount, { via: "handles" }>;
    plan: ExternalHarnessTaskPlan;
    logger: EvalLogger;
    onRunExecuted?: () => Promise<void>;
  },
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const result = await withTimeout(
      executeCodeExposureSnippet({
        code,
        handles: input.mount.handles,
        runToolSpec: input.mount.runTool,
        plan: input.plan,
        logger: input.logger,
        logCategory: "deepagents",
      }),
      readPositiveIntEnv("EVAL_DEEPAGENTS_RUN_TOOL_TIMEOUT_MS", 60_000),
    );
    const text = stringifyToolResult(result);
    input.logger.log({
      category: "deepagents",
      message: `run tool completed: ${clipToolResult(text, 500)}`,
      level: 2,
    });
    await notifyRunExecuted(input.onRunExecuted);
    return { content: [{ type: "text", text }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.logger.warn({
      category: "deepagents",
      message: `run tool failed: ${message}`,
      level: 1,
    });
    // Evidence is recorded on failures too: codex and claude_code both probe
    // after every run, so a failed step still consumes an observation index.
    await notifyRunExecuted(input.onRunExecuted);
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

// Evidence collection is best-effort: a probe failure must never turn a
// successful run into an error result.
async function notifyRunExecuted(onRunExecuted?: () => Promise<void>): Promise<void> {
  try {
    await onRunExecuted?.();
  } catch {
    // best-effort only
  }
}

function readPositiveIntEnv(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`run tool timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
