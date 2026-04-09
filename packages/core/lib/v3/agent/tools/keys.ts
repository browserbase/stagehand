import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";
import type { Variables } from "../../types/public/agent.js";
import { substituteVariables } from "../utils/variables.js";

export const keysTool = (v3: V3, variables?: Variables) => {
  const hasVariables = variables && Object.keys(variables).length > 0;
  const valueDescription = hasVariables
    ? `The text to type, or the key/combo to press (Enter, Tab, Cmd+A). Use %variableName% to substitute a variable value. Available: ${Object.keys(variables).join(", ")}`
    : "The text to type, or the key/combo to press (Enter, Tab, Cmd+A)";

  return tool({
    description: `Send keyboard input to the page without targeting a specific element. Unlike the type tool which clicks then types into coordinates, this sends keystrokes directly to wherever focus currently is.

Use method="type" to enter text into the currently focused element. Preferred when: input is already focused, text needs to flow across multiple fields (e.g., verification codes)

Use method="press" for navigation keys (Enter, Tab, Escape, Backspace, arrows) and keyboard shortcuts (Cmd+A, Ctrl+C, Shift+Tab).`,
    inputSchema: z.object({
      method: z.enum(["press", "type"]),
      value: z.string().describe(valueDescription),
      repeat: z.number().optional(),
    }),
    execute: async ({ method, value, repeat }) => {
      try {
        const page = await v3.context.awaitActivePage();
        v3.logger({
          category: "agent",
          message: `Agent calling tool: keys`,
          level: 1,
          auxiliary: {
            arguments: {
              value: JSON.stringify({ method, value, repeat }),
              type: "object",
            },
          },
        });

        const times = Math.max(1, repeat ?? 1);

        if (method === "type") {
          // Substitute any %variableName% tokens in the value
          const actualValue = substituteVariables(value, variables);
          for (let i = 0; i < times; i++) {
            await page.type(actualValue, { delay: 100 });
          }
          v3.recordAgentReplayStep({
            type: "keys",
            instruction: `type "${value}"`,
            playwrightArguments: { method, text: value, times },
          });
          // Return original value (with %variableName% tokens) to avoid exposing sensitive values to LLM
          return { success: true, method, value, times };
        }

        if (method === "press") {
          for (let i = 0; i < times; i++) {
            await page.keyPress(value, { delay: 100 });
          }
          v3.recordAgentReplayStep({
            type: "keys",
            instruction: `press ${value}`,
            playwrightArguments: { method, keys: value, times },
          });
          return { success: true, method, value, times };
        }

        return { success: false, error: `Unsupported method: ${method}` };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  });
};
