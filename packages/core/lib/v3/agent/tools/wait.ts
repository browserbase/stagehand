import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";
import type {
  WaitToolResult,
  ModelOutputContentItem,
} from "../../types/public/agent.js";
import { waitAndCaptureScreenshot } from "../utils/screenshotHandler.js";

import type { Page } from "../../understudy/page.js";
import type { AgentToolMode } from "../../types/public/agent.js";
import { resolvePage } from "../utils/resolvePage.js";

export const waitTool = (v3: V3, mode?: AgentToolMode, page?: Page) => {

  return tool({
    description: "Wait for a specified time",
    inputSchema: z.object({
      timeMs: z.number().describe("Time in milliseconds"),
    }),
    execute: async ({ timeMs }): Promise<WaitToolResult> => {
      v3.logger({
        category: "agent",
        message: `Agent calling tool: wait`,
        level: 1,
        auxiliary: {
          arguments: {
            value: `Waiting for ${timeMs} milliseconds`,
            type: "string",
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, timeMs));
      if (timeMs > 0) {
        v3.recordAgentReplayStep({ type: "wait", timeMs });
      }

      // Take screenshot after wait in hybrid mode for visual feedback
      if (mode === "hybrid") {
        const activePage = await resolvePage(v3, page);
        const screenshotBase64 = await waitAndCaptureScreenshot(activePage, 0);
        return { success: true, waited: timeMs, screenshotBase64 };
      }

      return { success: true, waited: timeMs };
    },
    toModelOutput: (result) => {
      if (result.success === false || result.error !== undefined) {
        return {
          type: "content",
          value: [{ type: "text", text: JSON.stringify(result) }],
        };
      }

      const content: ModelOutputContentItem[] = [
        {
          type: "text",
          text: JSON.stringify({
            success: result.success,
            waited: result.waited,
          }),
        },
      ];
      if (result.screenshotBase64) {
        content.push({
          type: "media",
          mediaType: "image/png",
          data: result.screenshotBase64,
        });
      }
      return { type: "content", value: content };
    },
  });
};
