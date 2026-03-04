import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";
import type { Page } from "../../understudy/page.js";
import { resolveActivePage } from "../utils/activePage.js";

export const gotoTool = (v3: V3, page?: Page) => {

  return tool({
    description: "Navigate to a specific URL",
    inputSchema: z.object({
      url: z.string().describe("The URL to navigate to"),
    }),
    execute: async ({ url }) => {
      try {
        v3.logger({
          category: "agent",
          message: `Agent calling tool: goto`,
          level: 1,
          auxiliary: {
            arguments: {
              value: url,
              type: "string",
            },
          },
        });
        const activePage = await resolveActivePage(v3, page);
        await activePage.goto(url, { waitUntil: "load" });
        v3.recordAgentReplayStep({ type: "goto", url, waitUntil: "load" });
        return { success: true, url };
      } catch (error) {
        return { success: false, error: error?.message ?? String(error) };
      }
    },
  });
};
