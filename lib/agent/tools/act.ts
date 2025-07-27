import { tool } from "ai";
import { z } from "zod";
import { Stagehand } from "../../index";

export const createActClickTool = (stagehand: Stagehand) => {
  return tool({
    description:
      "Click on an element on the page. Use this for buttons, links, or any clickable element.",
    parameters: z.object({
      action: z.string().describe("Natural language description of what element to click"),
    }),
    execute: async ({ action }: { action: string }) => {
      try {
        const result = await stagehand.page.act({
          action: `click on ${action}`,
        });

        return {
          success: result.success,
          message: result.message,
          action: result.action,
          timestamp: Date.now(),
        };
      } catch (error) {
        console.error("Error clicking element:", error);
        return {
          success: false,
          message: error instanceof Error ? error.message : "Failed to click element",
          action: action,
          timestamp: Date.now(),
        };
      }
    },
  });
};

export const createActTypeTool = (stagehand: Stagehand) => {
  return tool({
    description:
      "Type text into an input field or text area. Use this to fill in forms or search boxes.",
    parameters: z.object({
      action: z.string().describe("Natural language description of where to type"),
      text: z.string().describe("The text to type"),
    }),
    execute: async ({ action, text }: { action: string; text: string }) => {
      try {
        const result = await stagehand.page.act({
          action: `type "${text}" into ${action}`,
        });

        return {
          success: result.success,
          message: result.message,
          action: result.action,
          timestamp: Date.now(),
        };
      } catch (error) {
        console.error("Error typing text:", error);
        return {
          success: false,
          message: error instanceof Error ? error.message : "Failed to type text",
          action: action,
          text: text,
          timestamp: Date.now(),
        };
      }
    },
  });
};