import { createGotoTool } from "./goto";
import { createActTool } from "./act";
import { createScreenshotTool } from "./screenshot";
import { createWaitTool } from "./wait";
import { createNavBackTool } from "./navback";
import { createCloseTool } from "./close";
import { createAriaTreeTool } from "./ariaTree";
import { createFillFormTool } from "./fillform";
import { createScrollTool } from "./scroll";
import { Stagehand } from "../../index";
import { LogLine } from "@/types/log";
import { createExtractTool } from "./extract";

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
    close: createCloseTool(),
    extract: createExtractTool(stagehand, executionModel, options?.logger),
    fillForm: createFillFormTool(stagehand, executionModel),
    goto: createGotoTool(stagehand),
    navback: createNavBackTool(stagehand),
    screenshot: createScreenshotTool(stagehand),
    scroll: createScrollTool(stagehand),
    wait: createWaitTool(),
  };
}

export type AgentTools = ReturnType<typeof createAgentTools>;
