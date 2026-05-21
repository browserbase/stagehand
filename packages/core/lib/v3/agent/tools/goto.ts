import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";
import type { Variables } from "../../types/public/agent.js";
import { substituteVariables } from "../utils/variables.js";

export const gotoTool = (v3: V3, variables?: Variables) => {
  const hasVariables = variables && Object.keys(variables).length > 0;
  const urlDescription = hasVariables
    ? `The URL to navigate to. Use %variableName% to substitute a variable value. Available: ${Object.keys(variables).join(", ")}`
    : "The URL to navigate to";

  return tool({
    description: "Navigate to a specific URL",
    inputSchema: z.object({
      url: z.string().describe(urlDescription),
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
        const resolvedUrl = substituteVariables(url, variables);
        const page = await v3.context.awaitActivePage();
        await page.goto(resolvedUrl, { waitUntil: "load" });
        v3.recordAgentReplayStep({ type: "goto", url, waitUntil: "load" });
        return { success: true, url };
      } catch (error) {
        return { success: false, error: error?.message ?? String(error) };
      }
    },
  });
};
