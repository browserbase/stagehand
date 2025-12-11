import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3";

export const createKeysTool = (v3: V3) =>
  tool({
    description:
      "Send keyboard events: press, type, or insertText. Supports combinations like Cmd+A, Ctrl+C, etc. One really good use case of this tool is clearing text from an input that is currently focused.",
    inputSchema: z.object({
      method: z
        .enum(["press", "type"])
        .describe("Keyboard method to use: 'press' for key combinations, 'type' for text input"),
      keys: z
        .string()
        .optional()
        .describe(
          "Key or combo for press method. Use '+' to combine, e.g. 'Cmd+A' or 'Ctrl+C'.",
        ),
      text: z.string().optional().describe("Text for type method"),
      repeat: z
        .number()
        .optional()
        .describe("Repeat count for press/type. Default 1."),
    }),
    execute: async ({ method, keys, text, repeat }) => {
      try {
        const page = await v3.context.awaitActivePage();
        v3.logger({
          category: "agent",
          message: `Agent calling tool: keys`,
          level: 1,
          auxiliary: {
            arguments: {
              value: JSON.stringify({ method, keys, text, repeat }),
              type: "string",
            },
          },
        });

        const times = Math.max(1, repeat ?? 1);

        if (method === "type") {
          if (!text || text === "")
            return {
              success: false,
              error: "'text' is required for method 'type'",
            };
          for (let i = 0; i < times; i++) {
            await page.type(text, { delay: 100 });
          }
          v3.recordAgentReplayStep({
            type: "keys",
            instruction: `type "${text}"`,
            playwrightArguments: { method, text, times },
          });
          return { success: true, method, text, times };
        }

        if (method === "press") {
          if (!keys || keys === "")
            return {
              success: false,
              error: "'keys' is required for method 'press'",
            };
          for (let i = 0; i < times; i++) {
            await page.keyPress(keys, { delay: 100 });
          }
          v3.recordAgentReplayStep({
            type: "keys",
            instruction: `press ${keys}`,
            playwrightArguments: { method, keys, times },
          });
          return {
            success: true,
            method,
            keys,
            times,
          };
        }

        return { success: false, error: `Unsupported method: ${method}` };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },
  });
