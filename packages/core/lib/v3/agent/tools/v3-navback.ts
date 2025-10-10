import { tool } from "ai";
import { z } from "zod/v3";
import type { V3 } from "../../v3";

export const createNavBackTool = (v3: V3) =>
  tool({
    description: "Navigate back to the previous page",
    parameters: z.object({
      reasoning: z.string().describe("Why you're going back"),
    }),
    execute: async () => {
      const page = await v3.context.awaitActivePage();
      await page.goBack({ waitUntil: "domcontentloaded" });
      v3.recordAgentReplayStep({
        type: "navback",
        waitUntil: "domcontentloaded",
      });
      return { success: true };
    },
  });
