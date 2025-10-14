import { tool } from "ai";
import { z } from "zod/v3";
import { Stagehand } from "../../index";

export const createGotoTool = (stagehand: Stagehand) =>
  tool({
    description: "Navigate to a specific URL",
    parameters: z.object({
      url: z.string().describe("The URL to navigate to"),
    }),
    execute: async ({ url }) => {
      try {
        stagehand.logger({
          category: "agent",
          message: `Agent calling tool: goto`,
          level: 1,
          auxiliary: {
            arguments: {
              value: url,
              type: "string",
            },
          },
        });
        await stagehand.page.goto(url, { waitUntil: "load" });
        return { success: true, url };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  });
