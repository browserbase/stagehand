import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";

export const navBackTool = (v3: V3) =>
  tool({
    description: "Navigate back to the previous page",
    inputSchema: z.object({
      reasoningText: z.string().describe("Why you're going back"),
    }),
    execute: async () => {
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
    },
  });
