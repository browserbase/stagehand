import { tool } from "ai";
import { z } from "zod";
import { Page } from "@/types/page";

export const createScrollTool = (page: Page) =>
  tool({
    description: "Scroll the page",
    parameters: z.object({
      pixels: z.number().describe("Number of pixels to scroll"),
    }),
    execute: async ({ pixels }) => {
      await page.mouse.wheel(0, pixels);
      return { success: true, pixels };
    },
  });
