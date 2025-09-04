import { tool } from "ai";
import { z } from "zod/v3";
import { StagehandPage } from "../../StagehandPage";

export const createScreenshotTool = (stagehandPage: StagehandPage) =>
  tool({
    description:
      "Takes a screenshot of the current page. Use this tool to learn where you are on the page, or to get context of elements on the page",
    parameters: z.object({}),
    execute: async () => {
      const screenshotBuffer = await stagehandPage.page.screenshot({
        fullPage: false,
        type: "jpeg",
      });
      const pageUrl = stagehandPage.page.url();

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
