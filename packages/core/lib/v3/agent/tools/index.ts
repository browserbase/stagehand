import { createGotoTool } from "./v3-goto";
import { createActTool } from "./v3-act";
import { createScreenshotTool } from "./v3-screenshot";
import { createWaitTool } from "./v3-wait";
import { createNavBackTool } from "./v3-navback";
import { createCloseTool } from "./v3-close";
import { createAriaTreeTool } from "./v3-ariaTree";
import { createFillFormTool } from "./v3-fillform";
import { createScrollTool } from "./v3-scroll";
import { createExtractTool } from "./v3-extract";
import { createClickTool } from "./v3-click";
import { createTypeTool } from "./v3-type";
import { createDragAndDropTool } from "./v3-dragAndDrop";
import { createClickAndHoldTool } from "./v3-clickAndHold";
import { createKeysTool } from "./v3-keys";
import { createFillFormVisionTool } from "./v3-fillFormVision";
import { createThinkTool } from "./v3-think";
import { createSearchTool } from "./v3-search";
import type { ToolSet, InferUITools } from "ai";
import type { V3 } from "../../v3";
import type { LogLine } from "../../types/public/logs";
import type { AgentToolMode } from "../../types/public/agent";

export interface V3AgentToolOptions {
  executionModel?: string;
  logger?: (message: LogLine) => void;
  /**
   * Tool mode determines which set of tools are available.
   * - 'dom' (default): Uses DOM-based tools (act, fillForm) - removes coordinate-based tools
   * - 'hybrid': Uses coordinate-based tools (click, type, dragAndDrop, etc.) - removes fillForm
   */
  mode?: AgentToolMode;
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

  const allTools = {
    act: createActTool(v3, executionModel),
    ariaTree: createAriaTreeTool(v3),
    click: createClickTool(v3),
    clickAndHold: createClickAndHoldTool(v3),
    close: createCloseTool(),
    dragAndDrop: createDragAndDropTool(v3),
    extract: createExtractTool(v3, executionModel, options?.logger),
    fillForm: createFillFormTool(v3, executionModel),
    fillFormVision: createFillFormVisionTool(v3),
    goto: createGotoTool(v3),
    keys: createKeysTool(v3),
    navback: createNavBackTool(v3),
    screenshot: createScreenshotTool(v3),
    scroll: createScrollTool(v3),
    search: createSearchTool(v3),
    think: createThinkTool(),
    type: createTypeTool(v3),
    wait: createWaitTool(v3),
  };

  return filterToolsByMode(allTools, mode);
}

export type AgentTools = ReturnType<typeof createAgentTools>;

/**
 * Type map of all agent tools for strong typing of tool calls and results.
 */
export type AgentToolTypesMap = {
  act: ReturnType<typeof createActTool>;
  ariaTree: ReturnType<typeof createAriaTreeTool>;
  click: ReturnType<typeof createClickTool>;
  clickAndHold: ReturnType<typeof createClickAndHoldTool>;
  close: ReturnType<typeof createCloseTool>;
  dragAndDrop: ReturnType<typeof createDragAndDropTool>;
  extract: ReturnType<typeof createExtractTool>;
  fillForm: ReturnType<typeof createFillFormTool>;
  fillFormVision: ReturnType<typeof createFillFormVisionTool>;
  goto: ReturnType<typeof createGotoTool>;
  keys: ReturnType<typeof createKeysTool>;
  navback: ReturnType<typeof createNavBackTool>;
  screenshot: ReturnType<typeof createScreenshotTool>;
  scroll: ReturnType<typeof createScrollTool>;
  search: ReturnType<typeof createSearchTool>;
  think: ReturnType<typeof createThinkTool>;
  type: ReturnType<typeof createTypeTool>;
  wait: ReturnType<typeof createWaitTool>;
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
