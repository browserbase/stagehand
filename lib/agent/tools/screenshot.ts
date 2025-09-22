import { tool } from "ai";
import { z } from "zod/v3";
import { Stagehand } from "../../index";

export const createScreenshotTool = (stagehand: Stagehand) =>
  tool({
    description:
      "Takes a screenshot of the current page. Use this tool to learn where you are on the page, or to get context of elements on the page",
    parameters: z.object({}),
    execute: async () => {
      try {
        const screenshotBuffer = await stagehand.page.screenshot({
          fullPage: false,
          type: "jpeg",
        });
        const pageUrl = stagehand.page.url();

        return {
          base64: screenshotBuffer.toString("base64"),
          timestamp: Date.now(),
          pageUrl,
        };
      } catch {
        return {
          error: `Error taking screenshot, try again`,
        };
      }
    },
    experimental_toToolResultContent: (result) => {
      if (result.error) {
        return [{ type: "text", text: `Error, try again: ${result.error}` }];
      }

      return [
        {
          type: "image",
          data: result.base64,
          mimeType: "image/jpeg",
        },
      ];
    },
  });
