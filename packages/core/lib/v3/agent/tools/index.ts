import { gotoTool } from "./goto";
import { actTool } from "./act";
import { screenshotTool } from "./screenshot";
import { waitTool } from "./wait";
import { navBackTool } from "./navback";
import { closeTool } from "./close";
import { ariaTreeTool } from "./ariaTree";
import { fillFormTool } from "./fillform";
import { scrollTool, scrollVisionTool } from "./scroll";
import { extractTool } from "./extract";
import { clickTool } from "./click";
import { typeTool } from "./type";
import { dragAndDropTool } from "./dragAndDrop";
import { clickAndHoldTool } from "./clickAndHold";
import { keysTool } from "./keys";
import { fillFormVisionTool } from "./fillFormVision";
import { thinkTool } from "./think";
import { searchTool } from "./search";

import type { ToolSet, InferUITools } from "ai";
import type { V3 } from "../../v3";
import type { LogLine } from "../../types/public/logs";
import type { AgentToolMode } from "../../types/public/agent";
import type { ModelConfiguration } from "../../types/public/model";

export interface V3AgentToolOptions {
  executionModel?: ModelConfiguration;
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
}

/**
 * Filters tools based on the agent mode.
 * - 'dom' mode: Removes coordinate-based tools (click, type, dragAndDrop, clickAndHold, fillFormVision)
 * - 'hybrid' mode: Removes DOM-based form tool (fillForm) in favor of coordinate-based fillFormVision
 */
function filterToolsByMode(tools: ToolSet, mode: AgentToolMode): ToolSet {
  const filtered: ToolSet = { ...tools };

  if (mode === "hybrid") {
    // Hybrid mode: Remove DOM-based fillForm, keep coordinate-based tools
    delete filtered.fillForm;
    return filtered;
  }

  // DOM mode (default): Remove coordinate-based tools, keep DOM-based tools
  delete filtered.click;
  delete filtered.type;
  delete filtered.dragAndDrop;
  delete filtered.clickAndHold;
  delete filtered.fillFormVision;
  return filtered;
}

export function createAgentTools(v3: V3, options?: V3AgentToolOptions) {
  const executionModel = options?.executionModel;
  const mode = options?.mode ?? "dom";
  const provider = options?.provider;

  const allTools: ToolSet = {
    act: actTool(v3, executionModel),
    ariaTree: ariaTreeTool(v3),
    click: clickTool(v3, provider),
    clickAndHold: clickAndHoldTool(v3, provider),
    close: closeTool(),
    dragAndDrop: dragAndDropTool(v3, provider),
    extract: extractTool(v3, executionModel, options?.logger),
    fillForm: fillFormTool(v3, executionModel),
    fillFormVision: fillFormVisionTool(v3, provider),
    goto: gotoTool(v3),
    keys: keysTool(v3),
    navback: navBackTool(v3),
    screenshot: screenshotTool(v3),
    scroll: mode === "hybrid" ? scrollVisionTool(v3, provider) : scrollTool(v3),
    think: thinkTool(),
    type: typeTool(v3, provider),
    wait: waitTool(v3),
  };

  // Only include search tool if BRAVE_API_KEY is configured
  if (process.env.BRAVE_API_KEY) {
    allTools.search = searchTool(v3);
  }

  return filterToolsByMode(allTools, mode);
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
  close: ReturnType<typeof closeTool>;
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
