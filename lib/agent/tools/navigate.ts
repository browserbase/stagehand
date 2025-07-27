import { tool } from "ai";
import { z } from "zod";
import { Stagehand } from "../../index";

export const createNavigateTool = (stagehand: Stagehand) => {
  return tool({
    description:
      "Navigate to a URL in the browser. Only use this tool with URLs you're confident will work and stay up to date.",

    parameters: z.object({
      url: z.string().describe("The URL to navigate to"),
    }),

    execute: async ({ url }: { url: string }) => {
      try {
        const page = stagehand.page;
        const currentUrl = page.url();
        const isSameUrl = url === currentUrl;

        if (isSameUrl) {
          return {
            success: true,
            action: `Already on: ${url}`,
            message: `Already on: ${url}`,
            url: url,
            timestamp: Date.now(),
          };
        } else {
          await page.goto(url, { waitUntil: "commit" });

          return {
            success: true,
            action: `Navigated to: ${url}`,
            message: `Successfully navigated to: ${url}`,
            url: url,
            timestamp: Date.now(),
          };
        }
      } catch (error) {
        console.error("Error navigating to URL:", error);
        return {
          success: false,
          error: "Failed to navigate",
          message:
            error instanceof Error ? error.message : "Unknown error occurred",
          url: url,
          timestamp: Date.now(),
        };
      }
    },

    experimental_toToolResultContent: (result) => {
      if (result.success) {
        return [{ type: "text", text: `✅ ${result.action}` }];
      } else {
        return [{ type: "text", text: `❌ Error: ${result.message}` }];
      }
    },
  });
};
