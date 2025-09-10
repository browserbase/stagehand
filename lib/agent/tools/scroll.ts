import { tool } from "ai";
import { z } from "zod/v3";
import { StagehandPage } from "../../StagehandPage";

export const createScrollTool = (stagehandPage: StagehandPage) =>
  tool({
    description: "Scroll the page",
    parameters: z.object({
      pixels: z.number().describe("Number of pixels to scroll up or down"),
      direction: z.enum(["up", "down"]).describe("Direction to scroll"),
    }),
    execute: async ({ pixels, direction }) => {
      await stagehandPage.page.mouse.wheel(
        0,
        direction === "up" ? -pixels : pixels,
      );
      return { success: true, pixels };
    },
  });
