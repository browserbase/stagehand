import { tool } from "ai";
import { z } from "zod/v3";
import { Stagehand } from "../../index";
import { resolvePlatform, normalizeKeys } from "../utils/cuaKeyMapping";

// Schema for models that support optional parameters well
const defaultParametersSchema = z.object({
  method: z
    .enum(["press", "down", "up", "type", "insertText"])
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
});

// Schema for GPT-5: make all parameters required
// Use empty string "" for unused params (keys for type/insertText, text for press/down/up)
const gpt5ParametersSchema = z.object({
  method: z
    .enum(["press", "down", "up", "type", "insertText"])
    .describe("Keyboard method to use"),
  keys: z
    .union([z.string(), z.array(z.string())])
    .describe(
      "Key or combo for press/down/up. Use '+' to combine, e.g. 'mod+a' or ['Control','A']. Use empty string '' for type/insertText methods.",
    ),
  text: z
    .string()
    .describe(
      "Text for type/insertText methods. Use empty string '' for press/down/up methods.",
    ),
  repeat: z
    .number()
    .describe("Repeat count for press/type. Use 1 for single execution."),
});

export const createKeysTool = (stagehand: Stagehand, isGpt5 = false) => {
  const parametersSchema = isGpt5
    ? gpt5ParametersSchema
    : defaultParametersSchema;

  return tool({
    description:
      "Send keyboard events: press, down, up, type, or insertText. Supports combinations like mod+a, cmd+c, ctrl+v, etc. 'mod' maps to Command on macOS and Control on Windows/Linux. One really good use case of this tool, is clearing text from an input that is currently focused",
    parameters: parametersSchema as z.ZodType<{
      method: "press" | "down" | "up" | "type" | "insertText";
      keys?: string | string[];
      text?: string;
      repeat?: number;
    }>,
    execute: async ({ method, keys, text, repeat }) => {
      try {
        const userAgent = await stagehand.page.evaluate(
          () => navigator.userAgent,
        );
        const resolvedPlatform = resolvePlatform("auto", userAgent);

        const times = Math.max(1, repeat ?? 1);

        if (method === "type") {
          if (!text || text === "")
            return {
              success: false,
              error: "'text' is required for method 'type'",
            };
          for (let i = 0; i < times; i++) {
            await stagehand.page.keyboard.type(text, { delay: 100 });
          }
          return { success: true, method, text, times };
        }

        if (method === "insertText") {
          if (!text || text === "")
            throw new Error("'text' is required for method 'insertText'");
          for (let i = 0; i < times; i++) {
            await stagehand.page.keyboard.insertText(text);
            await stagehand.page.waitForTimeout(100);
          }
          return { success: true, method, text, times };
        }

        if (!keys || keys === "" || (Array.isArray(keys) && keys.length === 0))
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
        return { success: false, error: (error as Error).message };
      }
    },
  });
};
