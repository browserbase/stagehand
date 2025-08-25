import { Page } from "@/types/page";
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

export interface AgentToolOptions {
  executionModel?: string;
}

export function createAgentTools(page: Page, options?: AgentToolOptions) {
  const executionModel = options?.executionModel;

  return {
    act: createActTool(page, executionModel),
    ariaTree: createAriaTreeTool(page),
    close: createCloseTool(),
    extract: createExtractTool(page, executionModel),
    fillForm: createFillFormTool(page, executionModel),
    goto: createGotoTool(page),
    navback: createNavBackTool(page),
    screenshot: createScreenshotTool(page),
    scroll: createScrollTool(page),
    wait: createWaitTool(),
  };
}

export type AgentTools = ReturnType<typeof createAgentTools>;
