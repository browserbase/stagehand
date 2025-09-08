import { createGotoTool } from "./goto";
import { createActTool } from "./act";
import { createScreenshotTool } from "./screenshot";
import { createWaitTool } from "./wait";
import { createNavBackTool } from "./navback";
import { createCloseTool } from "./close";
import { createAriaTreeTool } from "./ariaTree";
import { createFillFormTool } from "./fillform";
import { createScrollTool } from "./scroll";
import { StagehandPage } from "../../StagehandPage";
import { LogLine } from "@/types/log";
import { thinkTool } from "./think";
import { createClickTool } from "./click";
import { createTypeTool } from "./type";
export interface AgentToolOptions {
  executionModel?: string;
  logger?: (message: LogLine) => void;
}

export function createAgentTools(
  stagehandPage: StagehandPage,
  options?: AgentToolOptions,
) {
  const executionModel = options?.executionModel;

  return {
    act: createActTool(stagehandPage, executionModel),
    ariaTree: createAriaTreeTool(stagehandPage),
    click: createClickTool(stagehandPage),
    type: createTypeTool(stagehandPage),
    close: createCloseTool(),
    think: thinkTool,
    fillForm: createFillFormTool(stagehandPage, executionModel),
    goto: createGotoTool(stagehandPage),
    navback: createNavBackTool(stagehandPage),
    screenshot: createScreenshotTool(stagehandPage),
    scroll: createScrollTool(stagehandPage),
    wait: createWaitTool(),
  };
}

export type AgentTools = ReturnType<typeof createAgentTools>;
