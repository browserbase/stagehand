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
import { createExtractTool } from "./extract";

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
    close: createCloseTool(),
    extract: createExtractTool(stagehandPage, executionModel, options?.logger),
    fillForm: createFillFormTool(stagehandPage, executionModel),
    goto: createGotoTool(stagehandPage),
    navback: createNavBackTool(stagehandPage),
    screenshot: createScreenshotTool(stagehandPage),
    scroll: createScrollTool(stagehandPage),
    wait: createWaitTool(),
  };
}

export type AgentTools = ReturnType<typeof createAgentTools>;
