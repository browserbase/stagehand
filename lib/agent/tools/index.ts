import { createGotoTool } from "./goto";
import { createActTool } from "./act";
import { createScreenshotTool } from "./screenshot";
import { createWaitTool } from "./wait";
import { createNavBackTool } from "./navback";
import { createCloseTool } from "./close";
import { createAriaTreeTool } from "./ariaTree";
import { createFillFormTool } from "./fillform";
import { createScrollTool } from "./scroll";
import { LogLine } from "@/types/log";
import { thinkTool } from "./think";
import { createClickTool } from "./click";
import { createTypeTool } from "./type";
import { createDragAndDropTool } from "./dragAndDrop";
import { createSearchTool } from "./search";
import { createKeysTool } from "./keys";
import { createClickAndHoldTool } from "./clickAndHold";
import { Stagehand } from "../../index";
import { createFillFormVisionTool } from "./fillformVision";
import type { ToolSet, ToolCallUnion, ToolResultUnion } from "ai";
export interface AgentToolOptions {
  executionModel?: string;
  logger?: (message: LogLine) => void;
  mainModel?: string;
}

function filterToolsByModelName(
  modelName: string | undefined,
  tools: ToolSet,
): ToolSet {
  const normalized = (modelName || "").toLowerCase().trim();
  const isAnthropic = normalized.startsWith("claude");
  if (isAnthropic) {
    delete (tools as Record<string, unknown>)["fillForm"];
    return tools;
  }
  const filtered: ToolSet = { ...tools } as ToolSet;
  delete (filtered as Record<string, unknown>)["dragAndDrop"];
  delete (filtered as Record<string, unknown>)["clickAndHold"];
  delete (filtered as Record<string, unknown>)["click"];
  delete (filtered as Record<string, unknown>)["type"];
  delete (filtered as Record<string, unknown>)["fillFormVision"];
  return filtered;
}

export function createAgentTools(
  stagehand: Stagehand,
  options?: AgentToolOptions,
) {
  const executionModel = options?.executionModel;
  const hasExaApiKey =
    typeof process.env.EXA_API_KEY === "string" &&
    process.env.EXA_API_KEY.length > 0;

  const all = {
    act: createActTool(stagehand, executionModel),
    ariaTree: createAriaTreeTool(stagehand),
    click: createClickTool(stagehand),
    clickAndHold: createClickAndHoldTool(stagehand),
    dragAndDrop: createDragAndDropTool(stagehand),
    type: createTypeTool(stagehand),
    close: createCloseTool(),
    think: thinkTool,
    fillForm: createFillFormTool(stagehand, executionModel),
    fillFormVision: createFillFormVisionTool(stagehand),
    goto: createGotoTool(stagehand),
    navback: createNavBackTool(stagehand),
    screenshot: createScreenshotTool(stagehand),
    scroll: createScrollTool(stagehand),
    wait: createWaitTool(),
    ...(hasExaApiKey ? { search: createSearchTool() } : {}),
    keys: createKeysTool(stagehand),
  } satisfies ToolSet;
  return filterToolsByModelName(options?.mainModel, all);
}

export type AgentTools = ReturnType<typeof createAgentTools>;

export type AgentToolTypesMap = {
  act: ReturnType<typeof createActTool>;
  ariaTree: ReturnType<typeof createAriaTreeTool>;
  click: ReturnType<typeof createClickTool>;
  clickAndHold: ReturnType<typeof createClickAndHoldTool>;
  dragAndDrop: ReturnType<typeof createDragAndDropTool>;
  type: ReturnType<typeof createTypeTool>;
  close: ReturnType<typeof createCloseTool>;
  think: typeof thinkTool;
  fillForm: ReturnType<typeof createFillFormTool>;
  fillFormVision: ReturnType<typeof createFillFormVisionTool>;
  goto: ReturnType<typeof createGotoTool>;
  navback: ReturnType<typeof createNavBackTool>;
  screenshot: ReturnType<typeof createScreenshotTool>;
  scroll: ReturnType<typeof createScrollTool>;
  wait: ReturnType<typeof createWaitTool>;
  search: ReturnType<typeof createSearchTool>;
  keys: ReturnType<typeof createKeysTool>;
};

export type AgentToolCall = ToolCallUnion<AgentToolTypesMap>;
export type AgentToolResult = ToolResultUnion<AgentToolTypesMap>;
