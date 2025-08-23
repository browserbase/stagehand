import { tool } from "ai";
import { z } from "zod";
import { Page } from "@/types/page";

export const createScreenshotTool = (page: Page) =>
  tool({
    description:
      "Takes a screenshot of the current page. Use this tool to learn where you are on the page, or to get context of elements on the page",
    parameters: z.object({}),
    execute: async () => {
      const screenshotBuffer = await page.screenshot({
        fullPage: false,
        type: "jpeg",
        quality: 60,
      });
      const pageUrl = page.url();

      console.log(`Screenshot size: ${screenshotBuffer.length} bytes`);

      return {
        base64: screenshotBuffer.toString("base64"),
        timestamp: Date.now(),
        pageUrl,
      };
    },
    experimental_toToolResultContent: (result) => {
      console.log(`Base64 length: ${result.base64.length} characters`);
      return [
        {
          type: "image",
          data: result.base64,
          mimeType: "image/jpeg",
        },
      ];
    },
  });
