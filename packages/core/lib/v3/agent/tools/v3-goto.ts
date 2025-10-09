import { tool } from "ai";
import { z } from "zod/v3";
import type { V3 } from "@/packages/core/lib/v3/v3";

export const createGotoTool = (v3: V3) =>
  tool({
    description: "Navigate to a specific URL",
    parameters: z.object({
      url: z.string().describe("The URL to navigate to"),
    }),
    execute: async ({ url }) => {
      try {
        const page = await v3.context.awaitActivePage();
        await page.goto(url, { waitUntil: "load" });
        v3.recordAgentReplayStep({ type: "goto", url, waitUntil: "load" });
        return { success: true, url };
      } catch (error) {
        return { success: false, error: error?.message ?? String(error) };
      }
    },
  });
