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
    return z.any();
  }
}

export const extractTool = (
  v3: V3,
  executionModel?: string,
  logger?: (message: LogLine) => void,
) =>
  tool({
    description: `Extract structured data from the current page based on a provided schema.
    
    USAGE GUIDELINES:
    - Keep schemas MINIMAL - only include fields essential for the task
    - IMPORANT: only use this if explicitly asked for structured output. In most scenarios, you should use the aria tree tool over this. 
    - If you need to extract a link, make sure the type defintion follows the format of z.string().url()
    EXAMPLES:
    1. Extract a single value:
       instruction: "extract the product price"
       schema: "z.object({ price: z.number()})"
    
    2. Extract multiple fields:
       instruction: "extract product name and price"
       schema: "z.object({ name: z.string(), price: z.number() })"
    
    3. Extract arrays:
       instruction: "extract all product names and prices"
       schema: "z.object({ products: z.array(z.object({ name: z.string(), price: z.number() })) })"`,
    inputSchema: z.object({
      instruction: z.string(),
      schema: z
        .string()
        .optional()
        .describe("Zod schema as code, e.g. z.object({ title: z.string() })"),
    }),
    execute: async ({ instruction, schema }) => {
      try {
        const parsedSchema = schema
          ? evaluateZodSchema(schema, logger)
          : undefined;
        const result = await v3.extract(instruction, parsedSchema, {
          ...(executionModel ? { model: executionModel } : {}),
        });
        return { success: true, result };
      } catch (error) {
        return { success: false, error: error?.message ?? String(error) };
      }
    },
  });
