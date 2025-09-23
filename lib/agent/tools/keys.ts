import { tool } from "ai";
import { z } from "zod/v3";
import { Stagehand } from "../../index";
import { resolvePlatform, normalizeKeys } from "../utils/cuaKeyMapping";

export const createKeysTool = (stagehand: Stagehand) =>
  tool({
    description:
      "Send keyboard events: press, down, up, type, or insertText. Supports combinations like mod+a, cmd+c, ctrl+v, etc. 'mod' maps to Command on macOS and Control on Windows/Linux. One really good use case of this tool, is clearing text from an input that is currently focused",
    parameters: z.object({
      method: z
        .enum(["press", "down", "up", "type", "insertText"]) // defaults to press if keys provided
        .describe("Keyboard method to use"),
      keys: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe(
          "Key or combo for press/down/up. Use '+' to combine, e.g. 'mod+a' or ['Control','A'].",
        ),
      text: z.string().optional().describe("Text for type/insertText methods"),
      repeat: z
        .number()
        .optional()
        .describe("Repeat count for press/type. Default 1."),
    }),
    execute: async ({ method, keys, text, repeat }) => {
      try {
        const userAgent = await stagehand.page.evaluate(
          () => navigator.userAgent,
        );
        const resolvedPlatform = resolvePlatform("auto", userAgent);

        const times = Math.max(1, repeat ?? 1);

        if (method === "type") {
          if (!text) throw new Error("'text' is required for method 'type'");
          for (let i = 0; i < times; i++) {
            await stagehand.page.keyboard.type(text, { delay: 100 });
          }
          return { success: true, method, text, times };
        }

        if (method === "insertText") {
          if (!text)
            throw new Error("'text' is required for method 'insertText'");
          for (let i = 0; i < times; i++) {
            await stagehand.page.keyboard.insertText(text);
            await stagehand.page.waitForTimeout(100);
          }
          return { success: true, method, text, times };
        }

        if (!keys)
          throw new Error("'keys' is required for methods press/down/up");
        const { combo, tokens } = normalizeKeys(keys, resolvedPlatform);

        if (method === "press") {
          for (let i = 0; i < times; i++) {
            await stagehand.page.keyboard.press(combo, { delay: 100 });
          }
          return {
            success: true,
            method,
            keys: combo,
            times,
          };
        }

        if (method === "down") {
          for (const token of tokens) {
            await stagehand.page.keyboard.down(token);
            await stagehand.page.waitForTimeout(100);
          }
          return {
            success: true,
            method,
            keys: tokens,
          };
        }

        if (method === "up") {
          // Release in reverse order for combos
          for (let i = tokens.length - 1; i >= 0; i--) {
            await stagehand.page.keyboard.up(tokens[i]);
            await stagehand.page.waitForTimeout(100);
          }
          return {
            success: true,
            method,
            keys: tokens,
          };
        }

        throw new Error(`Unsupported method: ${method}`);
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  });
