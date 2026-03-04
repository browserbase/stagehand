import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";
import type { Page } from "../../understudy/page.js";
import { resolveActivePage } from "../utils/activePage.js";

export const screenshotTool = (v3: V3, page?: Page) =>
  tool({
    description:
      "Takes a screenshot (PNG) of the current page. Use this to quickly verify page state.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        v3.logger({
          category: "agent",
          message: `Agent calling tool: screenshot`,
          level: 1,
        });
        const activePage = await resolveActivePage(v3, page);
        const buffer = await activePage.screenshot({ fullPage: false });
        const pageUrl = activePage.url();
        return {
          success: true,
          base64: buffer.toString("base64"),
          timestamp: Date.now(),
          pageUrl,
        };
      } catch (error) {
        return {
          success: false,
          error: `Error taking screenshot: ${(error as Error).message}`,
        };
      }
    },
    toModelOutput: (result) => {
      if (result.success === false || result.error !== undefined) {
        return {
          type: "content",
          value: [{ type: "text", text: JSON.stringify(result) }],
        };
      }

      return {
        type: "content",
        value: [{ type: "media", mediaType: "image/png", data: result.base64 }],
      };
    },
  });
