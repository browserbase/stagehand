import { type ToolSet } from "ai";
import { Page } from "../../../types/page";
import { Stagehand } from "../../index";
import { thinkTool } from "./think";
import { createScreenshotTool } from "./screenshot";
import { createNavigateTool } from "./navigate";
import { createGetAccessibilityTreeTool } from "./getAllyTree";
import { createWaitTool } from "./wait";
import { createActClickTool, createActTypeTool } from "./act";

/**
 * Create tools for the AI SDK agent
 * These tools provide basic web automation capabilities
 */
export const createAgentTools = (page: Page, stagehand: Stagehand): ToolSet => {
  return {
    think: thinkTool,
    screenshot: createScreenshotTool(page),
    navigate: createNavigateTool(stagehand),
    getAccessibilityTree: createGetAccessibilityTreeTool(page),
    wait: createWaitTool(),
    actClick: createActClickTool(stagehand),
    actType: createActTypeTool(stagehand),
  };
};
