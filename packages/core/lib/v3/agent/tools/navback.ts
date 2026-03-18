import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";
import { withTimeout } from "../../timeoutConfig.js";
import { TimeoutError } from "../../types/public/sdkErrors.js";

export const navBackTool = (v3: V3, toolTimeout?: number) =>
  tool({
    description: "Navigate back to the previous page",
    inputSchema: z.object({
      reasoningText: z.string().describe("Why you're going back"),
    }),
    execute: async () => {
      try {
        return await withTimeout(
          (async () => {
            v3.logger({
              category: "agent",
              message: `Agent calling tool: navback`,
              level: 1,
            });
            const page = await v3.context.awaitActivePage();
            await page.goBack({ waitUntil: "domcontentloaded" });
            v3.recordAgentReplayStep({
              type: "navback",
              waitUntil: "domcontentloaded",
            });
            return { success: true };
          })(),
          toolTimeout,
          "navback()",
        );
      } catch (error) {
        if (error instanceof TimeoutError) {
          const timeoutMessage = `TimeoutError: ${error.message}`;
          v3.logger({
            category: "agent",
            message: timeoutMessage,
            level: 0,
          });
          return {
            success: false,
            error: timeoutMessage,
          };
        }
        return {
          success: false,
          error: `Error navigating back: ${error.message}`,
        };
      }
    },
  });
