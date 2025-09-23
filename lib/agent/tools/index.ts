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
import { createExtractTool } from "./extract";
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
  const filtered: ToolSet = { ...tools };

  if (isAnthropic) {
    delete filtered.fillForm;
    return filtered;
  }
  delete filtered.dragAndDrop;
  delete filtered.clickAndHold;
  delete filtered.click;
  delete filtered.type;
  delete filtered.fillFormVision;
  return filtered;
}

export function createAgentTools(
  stagehand: Stagehand,
  options?: AgentToolOptions,
) {
  const executionModel = options?.executionModel;
  const hasExaApiKey = process.env.EXA_API_KEY?.length > 0;

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
    extract: createExtractTool(stagehand),
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
  extract: ReturnType<typeof createExtractTool>;
};

export type AgentToolCall = ToolCallUnion<AgentToolTypesMap>;
export type AgentToolResult = ToolResultUnion<AgentToolTypesMap>;
