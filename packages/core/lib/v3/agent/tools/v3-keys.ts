import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3";

export const createKeysTool = (v3: V3) =>
  tool({
    description: `Send keyboard events to the page. Two methods available:

• "type" - Types text character by character. Use for: entering words, filling text without clicking an input, typing into games like Wordle. Example: method="type", text="SLATE"

• "press" - Sends a single key or key combination. Use for: Enter, Escape, Tab, Backspace, arrow keys, shortcuts like Cmd+A, Ctrl+C. Example: method="press", keys="Enter"

IMPORTANT: For typing words/text, always use method="type" with the text parameter. Do NOT try to press individual letter keys.`,
    inputSchema: z.object({
      method: z
        .enum(["press", "type"])
        .describe("'type' for entering text/words character by character, 'press' for single keys or shortcuts"),
      keys: z
        .string()
        .optional()
        .describe(
          "For 'press' method only. Single key (Enter, Escape, Backspace, Tab) or combo with '+' (Cmd+A, Ctrl+C, Shift+Tab)",
        ),
      text: z
        .string()
        .optional()
        .describe("For 'type' method only. The text to type, e.g. 'hello world' or 'SLATE'"),
      repeat: z
        .number()
        .optional()
        .describe("Repeat count. Default 1."),
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
