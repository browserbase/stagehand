import { tool } from "ai";
import { z } from "zod/v3";
import { Stagehand } from "../../index";

export const createScrollTool = (stagehand: Stagehand) =>
  tool({
    description: "Scroll the page",
    parameters: z.object({
      pixels: z.number().describe("Number of pixels to scroll up or down"),
      direction: z.enum(["up", "down"]).describe("Direction to scroll"),
    }),
    execute: async ({ pixels, direction }) => {
      stagehand.logger({
        category: "agent",
        message: `Agent calling tool: scroll`,
        level: 1,
        auxiliary: {
          arguments: {
            value: JSON.stringify({ pixels, direction }),
            type: "object",
          },
        },
      });
      await stagehand.page.mouse.wheel(
        0,
        direction === "up" ? -pixels : pixels,
      );
      return { success: true, pixels };
    },
  });
