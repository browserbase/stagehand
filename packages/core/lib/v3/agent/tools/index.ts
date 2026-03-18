import { gotoTool } from "./goto.js";
import { actTool } from "./act.js";
import { screenshotTool } from "./screenshot.js";
import { waitTool } from "./wait.js";
import { navBackTool } from "./navback.js";
import { ariaTreeTool } from "./ariaTree.js";
import { fillFormTool } from "./fillform.js";
import { scrollTool, scrollVisionTool } from "./scroll.js";
import { extractTool } from "./extract.js";
import { clickTool } from "./click.js";
import { typeTool } from "./type.js";
import { dragAndDropTool } from "./dragAndDrop.js";
import { clickAndHoldTool } from "./clickAndHold.js";
import { keysTool } from "./keys.js";
import { fillFormVisionTool } from "./fillFormVision.js";
import { thinkTool } from "./think.js";
import { searchTool as browserbaseSearchTool } from "./browserbaseSearch.js";
import { searchTool as braveSearchTool } from "./braveSearch.js";

import type { ToolSet, InferUITools } from "ai";
import type { V3 } from "../../v3.js";
import type { LogLine } from "../../types/public/logs.js";
import type {
  AgentToolMode,
  AgentModelConfig,
  Variables,
} from "../../types/public/agent.js";
import { withTimeout } from "../../timeoutConfig.js";
import { TimeoutError } from "../../types/public/sdkErrors.js";

export interface V3AgentToolOptions {
  executionModel?: string | AgentModelConfig;
  logger?: (message: LogLine) => void;
  /**
   * Tool mode determines which set of tools are available.
   * - 'dom' (default): Uses DOM-based tools (act, fillForm) - removes coordinate-based tools
   * - 'hybrid': Uses coordinate-based tools (click, type, dragAndDrop, etc.) - removes fillForm
   */
  mode?: AgentToolMode;
  /**
   * The model provider. Used for model-specific coordinate handling
   */
  provider?: string;
  /**
   * Tools to exclude from the available toolset.
   * These tools will be filtered out after mode-based filtering.
   */
  excludeTools?: string[];
  /**
   * Variables available to the agent for use in act/type tools.
   * When provided, these tools will have an optional useVariable field.
   */
  variables?: Variables;
  /**
   * Timeout in milliseconds for async tool calls.
   * Applied to all tools that perform I/O (except wait and think).
   */
  toolTimeout?: number;
  /**
   * Whether to enable the Browserbase-powered web search tool.
   * Requires a valid Browserbase API key.
   */
  useSearch?: boolean;
  /**
   * The Browserbase API key used for the search tool.
   * Resolved from BROWSERBASE_API_KEY env var or the Stagehand constructor.
   */
  browserbaseApiKey?: string;
}

/**
 * Filters tools based on mode and explicit exclusions.
 * - 'dom' mode: Removes coordinate-based tools (click, type, dragAndDrop, clickAndHold, fillFormVision)
 * - 'hybrid' mode: Removes DOM-based form tool (fillForm) in favor of coordinate-based fillFormVision
 * - excludeTools: Additional tools to remove from the toolset
 */
function filterTools(
  tools: ToolSet,
  mode: AgentToolMode,
  excludeTools?: string[],
): ToolSet {
  const filtered: ToolSet = { ...tools };

  // Mode-based filtering
  if (mode === "hybrid") {
    delete filtered.fillForm;
  } else {
    // DOM mode (default)
    delete filtered.click;
    delete filtered.type;
    delete filtered.dragAndDrop;
    delete filtered.clickAndHold;
    delete filtered.fillFormVision;
  }

  if (excludeTools) {
    for (const toolName of excludeTools) {
      delete filtered[toolName];
    }
  }

  return filtered;
}

/**
 * Wraps an AI SDK tool's execute function with a timeout guard.
 * On timeout, returns `{ success: false, error: "TimeoutError: ..." }` to the LLM
 * and logs the error. Also acts as a safety net for any uncaught errors.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapToolWithTimeout<T extends Record<string, any>>(
  agentTool: T,
  toolName: string,
  v3: V3,
  timeoutMs?: number,
  timeoutHint?: string,
): T {
  if (!timeoutMs || !agentTool.execute) return agentTool;

  const originalExecute = agentTool.execute;
  return {
    ...agentTool,
    execute: async (...args: unknown[]) => {
      try {
        return await withTimeout(originalExecute(...args), timeoutMs, toolName);
      } catch (error) {
        const isTimeout = error instanceof TimeoutError;
        const message = isTimeout
          ? `TimeoutError: ${error.message}${timeoutHint ? ` ${timeoutHint}` : ""}`
          : ((error as Error)?.message ?? String(error));
        v3.logger({
          category: "agent",
          message,
          level: 0,
        });
        return {
          success: false,
          error: message,
        };
      }
    },
  } as T;
}

export function createAgentTools(v3: V3, options?: V3AgentToolOptions) {
  const executionModel = options?.executionModel;
  const mode = options?.mode ?? "dom";
  const provider = options?.provider;
  const excludeTools = options?.excludeTools;
  const variables = options?.variables;
  const toolTimeout = options?.toolTimeout;

  const allTools: ToolSet = {
    act: wrapToolWithTimeout(
      actTool(v3, executionModel, variables, toolTimeout),
      "act()",
      v3,
      toolTimeout,
      "(it may continue executing in the background) — try using a different description for the action",
    ),
    ariaTree: wrapToolWithTimeout(
      ariaTreeTool(v3, toolTimeout),
      "ariaTree()",
      v3,
      toolTimeout,
      "— the page may be too large",
    ),
    click: wrapToolWithTimeout(
      clickTool(v3, provider),
      "click()",
      v3,
      toolTimeout,
    ),
    clickAndHold: wrapToolWithTimeout(
      clickAndHoldTool(v3, provider),
      "clickAndHold()",
      v3,
      toolTimeout,
    ),
    dragAndDrop: wrapToolWithTimeout(
      dragAndDropTool(v3, provider),
      "dragAndDrop()",
      v3,
      toolTimeout,
    ),
    extract: wrapToolWithTimeout(
      extractTool(v3, executionModel, toolTimeout),
      "extract()",
      v3,
      toolTimeout,
      "— try using a smaller or simpler schema",
    ),
    fillForm: wrapToolWithTimeout(
      fillFormTool(v3, executionModel, variables, toolTimeout),
      "fillForm()",
      v3,
      toolTimeout,
      "(it may continue executing in the background) — try filling fewer fields at once or use a different tool",
    ),
    fillFormVision: wrapToolWithTimeout(
      fillFormVisionTool(v3, provider, variables),
      "fillFormVision()",
      v3,
      toolTimeout,
    ),
    goto: wrapToolWithTimeout(gotoTool(v3), "goto()", v3, toolTimeout),
    keys: wrapToolWithTimeout(keysTool(v3), "keys()", v3, toolTimeout),
    navback: wrapToolWithTimeout(navBackTool(v3), "navback()", v3, toolTimeout),
    screenshot: wrapToolWithTimeout(
      screenshotTool(v3),
      "screenshot()",
      v3,
      toolTimeout,
    ),
    scroll:
      mode === "hybrid"
        ? wrapToolWithTimeout(
            scrollVisionTool(v3, provider),
            "scroll()",
            v3,
            toolTimeout,
          )
        : wrapToolWithTimeout(scrollTool(v3), "scroll()", v3, toolTimeout),
    think: thinkTool(),
    type: wrapToolWithTimeout(
      typeTool(v3, provider, variables),
      "type()",
      v3,
      toolTimeout,
    ),
    wait: waitTool(v3, mode),
  };

  if (options?.useSearch && options.browserbaseApiKey) {
    allTools.search = wrapToolWithTimeout(
      browserbaseSearchTool(v3, options.browserbaseApiKey),
      "search()",
      v3,
      toolTimeout,
    );
  } else if (process.env.BRAVE_API_KEY) {
    allTools.search = wrapToolWithTimeout(
      braveSearchTool(v3),
      "search()",
      v3,
      toolTimeout,
    );
  }

  return filterTools(allTools, mode, excludeTools);
}

export type AgentTools = ReturnType<typeof createAgentTools>;

/**
 * Type map of all agent tools for strong typing of tool calls and results.
 * Note: `search` is optional — enabled via useSearch: true (Browserbase) or BRAVE_API_KEY env var (legacy).
 */
export type AgentToolTypesMap = {
  act: ReturnType<typeof actTool>;
  ariaTree: ReturnType<typeof ariaTreeTool>;
  click: ReturnType<typeof clickTool>;
  clickAndHold: ReturnType<typeof clickAndHoldTool>;
  dragAndDrop: ReturnType<typeof dragAndDropTool>;
  extract: ReturnType<typeof extractTool>;
  fillForm: ReturnType<typeof fillFormTool>;
  fillFormVision: ReturnType<typeof fillFormVisionTool>;
  goto: ReturnType<typeof gotoTool>;
  keys: ReturnType<typeof keysTool>;
  navback: ReturnType<typeof navBackTool>;
  screenshot: ReturnType<typeof screenshotTool>;
  scroll: ReturnType<typeof scrollTool> | ReturnType<typeof scrollVisionTool>;
  search?:
    | ReturnType<typeof browserbaseSearchTool>
    | ReturnType<typeof braveSearchTool>;
  think: ReturnType<typeof thinkTool>;
  type: ReturnType<typeof typeTool>;
  wait: ReturnType<typeof waitTool>;
};

/**
 * Inferred UI tools type for type-safe tool inputs and outputs.
 * Use with UIMessage for full type safety in UI contexts.
 */
export type AgentUITools = InferUITools<AgentToolTypesMap>;

/**
 * Union type for all possible agent tool calls.
 * Provides type-safe access to tool call arguments.
 */
export type AgentToolCall = {
  [K in keyof AgentToolTypesMap]: {
    toolName: K;
    toolCallId: string;
    args: AgentUITools[K]["input"];
  };
}[keyof AgentToolTypesMap];

/**
 * Union type for all possible agent tool results.
 * Provides type-safe access to tool result values.
 */
export type AgentToolResult = {
  [K in keyof AgentToolTypesMap]: {
    toolName: K;
    toolCallId: string;
    result: AgentUITools[K]["output"];
  };
}[keyof AgentToolTypesMap];
