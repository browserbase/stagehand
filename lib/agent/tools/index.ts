import { createGotoTool } from "./goto";
import { createActTool } from "./act";
import { createExtractTool } from "./extract";
import { createScreenshotTool } from "./screenshot";
import { createWaitTool } from "./wait";
import { createNavBackTool } from "./navback";
import { createCloseTool } from "./close";
import { createAriaTreeTool } from "./ariaTree";
import { createFillFormTool } from "./fillform";
import { createScrollTool } from "./scroll";
import { StagehandPage } from "../../StagehandPage";

export interface AgentToolOptions {
  executionModel?: string;
}

export function createAgentTools(
  stagehandPage: StagehandPage,
  options?: AgentToolOptions,
) {
  const executionModel = options?.executionModel;

  return {
    act: createActTool(stagehandPage, executionModel),
    ariaTree: createAriaTreeTool(stagehandPage),
    close: createCloseTool(stagehandPage),
    extract: createExtractTool(stagehandPage, executionModel),
    fillForm: createFillFormTool(stagehandPage, executionModel),
    goto: createGotoTool(stagehandPage),
    navback: createNavBackTool(stagehandPage),
    screenshot: createScreenshotTool(stagehandPage),
    scroll: createScrollTool(stagehandPage),
    wait: createWaitTool(),
  };
}

export type AgentTools = ReturnType<typeof createAgentTools>;
