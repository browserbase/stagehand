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
export interface AgentToolOptions {
  executionModel?: string;
  logger?: (message: LogLine) => void;
}

export function createAgentTools(
  stagehand: Stagehand,
  options?: AgentToolOptions,
) {
  const executionModel = options?.executionModel;

  return {
    act: createActTool(stagehand, executionModel),
    ariaTree: createAriaTreeTool(stagehand),
    click: createClickTool(stagehand),
    clickAndHold: createClickAndHoldTool(stagehand),
    dragAndDrop: createDragAndDropTool(stagehand),
    type: createTypeTool(stagehand),
    close: createCloseTool(),
    think: thinkTool,
    fillForm: createFillFormTool(stagehand, executionModel),
    goto: createGotoTool(stagehand),
    navback: createNavBackTool(stagehand),
    screenshot: createScreenshotTool(stagehand),
    scroll: createScrollTool(stagehand),
    wait: createWaitTool(),
    search: createSearchTool(),
    keys: createKeysTool(stagehand),
  };
}

export type AgentTools = ReturnType<typeof createAgentTools>;
