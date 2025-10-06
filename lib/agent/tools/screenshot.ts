import { tool } from "ai";
import { z } from "zod/v3";
import { Stagehand } from "../../index";

export const createScreenshotTool = (stagehand: Stagehand) =>
  tool({
    description:
      "Takes a screenshot of the current page. Use this tool to learn where you are on the page, or to get context of elements on the page",
    parameters: z.object({}),
    execute: async () => {
      stagehand.logger({
        category: "agent",
        message: `Agent calling tool: screenshot`,
        level: 1,
      });
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
    },
    experimental_toToolResultContent: (result) => {
      return [
        {
          type: "image",
          data: result.base64,
          mimeType: "image/jpeg",
        },
      ];
    },
  });
