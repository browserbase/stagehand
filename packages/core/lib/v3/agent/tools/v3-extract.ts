import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3";
import type { LogLine } from "../../types/public/logs";

function evaluateZodSchema(
  schemaStr: string,
  logger?: (message: LogLine) => void,
) {
  try {
    const fn = new Function("z", `return ${schemaStr}`);
    return fn(z);
  } catch (e) {
    logger?.({
      category: "agent",
      message: `Failed to evaluate schema: ${e?.message ?? String(e)}`,
      level: 0,
    });
    throw new Error(
      "Invalid schema: Ensure you're passing a valid Zod schema expression, e.g. z.object({ title: z.string() })",
    );
  }
}

export const createExtractTool = (
  v3: V3,
  executionModel?: string,
  logger?: (message: LogLine) => void,
) =>
  tool({
    description:
      "Extract structured data. Optionally provide an instruction and Zod schema.",
    inputSchema: z.object({
      instruction: z.string().optional(),
      schema: z
        .string()
        .optional()
        .describe("Zod schema as code, e.g. z.object({ title: z.string() })"),
      selector: z.string().optional(),
    }),
    execute: async ({ instruction, schema, selector }) => {
      try {
        const parsedSchema = schema
          ? evaluateZodSchema(schema, logger)
          : undefined;
        const result = await v3.extract(instruction, parsedSchema, {
          ...(executionModel ? { model: executionModel } : {}),
          selector,
        });
        return { success: true, result };
      } catch (error) {
        return { success: false, error: error?.message ?? String(error) };
      }
    },
  });
