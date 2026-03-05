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
import { searchTool } from "./search.js";

import type { ToolSet, InferUITools } from "ai";
import type { V3 } from "../../v3.js";
import type { LogLine } from "../../types/public/logs.js";
import type { Page } from "../../understudy/page.js";
import type {
  AgentToolMode,
  AgentModelConfig,
  Variables,
} from "../../types/public/agent.js";

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
   * Timeout in milliseconds for tool calls that invoke v3 methods (act, extract, fillForm, ariaTree).
   * Forwarded to the underlying v3 call's `timeout` option.
   */
  toolTimeout?: number;
  /**
   * Explicit page to use for all tools. When provided, tools use this page
   * instead of resolving via awaitActivePage().
   */
  page?: Page;
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

export function createAgentTools(v3: V3, options?: V3AgentToolOptions) {
  const executionModel = options?.executionModel;
  const mode = options?.mode ?? "dom";
  const provider = options?.provider;
  const excludeTools = options?.excludeTools;
  const variables = options?.variables;
  const toolTimeout = options?.toolTimeout;
  const page = options?.page;

  const toolOpts = {
    executionModel,
    provider,
    variables,
    mode,
    toolTimeout,
    page,
  };

  const allTools: ToolSet = {
    act: actTool(v3, toolOpts),
    ariaTree: ariaTreeTool(v3, toolOpts),
    click: clickTool(v3, toolOpts),
    clickAndHold: clickAndHoldTool(v3, toolOpts),
    dragAndDrop: dragAndDropTool(v3, toolOpts),
    extract: extractTool(v3, toolOpts),
    fillForm: fillFormTool(v3, toolOpts),
    fillFormVision: fillFormVisionTool(v3, toolOpts),
    goto: gotoTool(v3, toolOpts),
    keys: keysTool(v3, toolOpts),
    navback: navBackTool(v3, toolOpts),
    screenshot: screenshotTool(v3, toolOpts),
    scroll:
      mode === "hybrid"
        ? scrollVisionTool(v3, toolOpts)
        : scrollTool(v3, toolOpts),
    think: thinkTool(),
    type: typeTool(v3, toolOpts),
    wait: waitTool(v3, toolOpts),
  };

  if (process.env.BRAVE_API_KEY) {
    allTools.search = searchTool(v3);
  }

  return filterTools(allTools, mode, excludeTools);
}

export type AgentTools = ReturnType<typeof createAgentTools>;

/**
 * Type map of all agent tools for strong typing of tool calls and results.
 * Note: `search` is optional as it's only available when BRAVE_API_KEY is configured.
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
  search?: ReturnType<typeof searchTool>;
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
