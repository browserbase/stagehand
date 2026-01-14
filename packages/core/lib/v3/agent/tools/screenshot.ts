import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3";
import type { AgentMaskConfig } from "../../types/public/agent";
import { captureWithMask } from "../../understudy/screenshotUtils";

export const screenshotTool = (v3: V3, maskConfig?: AgentMaskConfig) =>
  tool({
    description:
      "Takes a screenshot (PNG) of the current page. Use this to quickly verify page state.",
    inputSchema: z.object({}),
    execute: async () => {
      v3.logger({
        category: "agent",
        message: `Agent calling tool: screenshot`,
        level: 1,
      });
      const page = await v3.context.awaitActivePage();
      const buffer = await captureWithMask(page, maskConfig);
      return {
        base64: buffer.toString("base64"),
        timestamp: Date.now(),
        pageUrl: page.url(),
      };
    },
    toModelOutput: (result) => ({
      type: "content",
      value: [{ type: "media", mediaType: "image/png", data: result.base64 }],
    }),
  });
