import { createGotoTool } from "./v3-goto";
import { createActTool } from "./v3-act";
import { createScreenshotTool } from "./v3-screenshot";
import { createWaitTool } from "./v3-wait";
import { createNavBackTool } from "./v3-navback";
import { createCloseTool } from "./v3-close";
import { createAriaTreeTool } from "./v3-ariaTree";
import { createFillFormTool } from "./v3-fillform";
import { createScrollTool } from "./v3-scroll";
import { createExtractTool } from "./v3-extract";
import type { V3 } from "../../v3";
import type { LogLine } from "../../types/public/logs";
import type { AgentToolName } from "../../types/public/agent";

export interface V3AgentToolOptions {
  executionModel?: string;
  logger?: (message: LogLine) => void;
  excludeTools?: AgentToolName[];
}

export function createAgentTools(v3: V3, options?: V3AgentToolOptions) {
  const executionModel = options?.executionModel;
  const excludeTools = new Set(options?.excludeTools ?? []);

  const allTools = {
    act: createActTool(v3, executionModel),
    ariaTree: createAriaTreeTool(v3),
    close: createCloseTool(),
    extract: createExtractTool(v3, executionModel, options?.logger),
    fillForm: createFillFormTool(v3, executionModel),
    goto: createGotoTool(v3),
    navback: createNavBackTool(v3),
    screenshot: createScreenshotTool(v3),
    scroll: createScrollTool(v3),
    wait: createWaitTool(v3),
  };

  // Filter out excluded tools
  const filteredTools = Object.fromEntries(
    Object.entries(allTools).filter(
      ([name]) => !excludeTools.has(name as AgentToolName),
    ),
  ) as Partial<typeof allTools>;

  return filteredTools;
}

export type AgentTools = ReturnType<typeof createAgentTools>;
