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
    act: createActTool(stagehandPage.page, executionModel),
    ariaTree: createAriaTreeTool(stagehandPage.page),
    close: createCloseTool(),
    extract: createExtractTool(stagehandPage.page, executionModel),
    fillForm: createFillFormTool(stagehandPage.page, executionModel),
    goto: createGotoTool(stagehandPage.page),
    navback: createNavBackTool(stagehandPage.page),
    screenshot: createScreenshotTool(stagehandPage.page),
    scroll: createScrollTool(stagehandPage.page),
    wait: createWaitTool(),
  };
}

export type AgentTools = ReturnType<typeof createAgentTools>;
