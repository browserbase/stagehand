import { Page } from "@/types/page";
import { createGotoTool } from "./goto";
import { createActTool } from "./act";
import { createExtractTool } from "./extract";
import { createScreenshotTool } from "./screenshot";
import { createWaitTool } from "./wait";
import { createNavBackTool } from "./navback";
import { createRefreshTool } from "./refresh";
import { createCloseTool } from "./close";
import { createAriaTreeTool } from "./ariaTree";
import { createFillFormTool } from "./fillform";
import { createScrollTool } from "./scroll";

export function createAgentTools(page: Page) {
  return {
    act: createActTool(page),
    ariaTree: createAriaTreeTool(page),
    close: createCloseTool(),
    extract: createExtractTool(page),
    fillForm: createFillFormTool(page),
    goto: createGotoTool(page),
    navback: createNavBackTool(page),
    refresh: createRefreshTool(page),
    screenshot: createScreenshotTool(page),
    scroll: createScrollTool(page),
    wait: createWaitTool(),
  } as const;
}

export type AgentTools = ReturnType<typeof createAgentTools>;
