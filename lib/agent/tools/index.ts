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

export function createAgentTools(page: Page) {
  return {
    goto: createGotoTool(page),
    act: createActTool(page),
    extract: createExtractTool(page),
    screenshot: createScreenshotTool(page),
    ariaTree: createAriaTreeTool(page),
    wait: createWaitTool(),
    navback: createNavBackTool(page),
    refresh: createRefreshTool(page),
    close: createCloseTool(),
  } as const;
}

export type AgentTools = ReturnType<typeof createAgentTools>;
