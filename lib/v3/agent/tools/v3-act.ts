import { tool } from "ai";
import { z } from "zod/v3";
import type { V3 } from "@/lib/v3/v3";

export const createActTool = (v3: V3, executionModel?: string) =>
  tool({
    description:
      "Perform an action on the page (click, type). Provide a short, specific phrase that mentions the element type.",
    parameters: z.object({
      action: z
        .string()
        .describe(
          'Describe what to click or type, e.g. "click the Login button" or "type "John" into the first name input"',
        ),
    }),
    execute: async ({ action }) => {
      try {
        const result = await v3.act({
          instruction: action,
          modelName: executionModel,
        });
        return {
          success: result.success ?? true,
          action: result?.action ?? action,
        };
      } catch (error) {
        return { success: false, error: error?.message ?? String(error) };
      }
    },
  });
