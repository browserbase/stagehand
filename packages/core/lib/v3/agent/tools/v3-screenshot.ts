import { tool } from "ai";
import { z } from "zod/v3";
import type { V3 } from "../../v3";

export const createScreenshotTool = (v3: V3) =>
  tool({
    description:
      "Takes a screenshot (PNG) of the current page. Use this to quickly verify page state.",
    parameters: z.object({}),
    execute: async () => {
      const page = await v3.context.awaitActivePage();
      const buffer = await page.screenshot({ fullPage: false });
      const pageUrl = page.url();
      return {
        base64: buffer.toString("base64"),
        timestamp: Date.now(),
        pageUrl,
      };
    },
    experimental_toToolResultContent: (result) => [
      { type: "image", data: result.base64, mimeType: "image/png" },
    ],
  });
