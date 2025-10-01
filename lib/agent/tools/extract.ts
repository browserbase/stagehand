import { tool } from "ai";
import { z } from "zod/v3";
import { Stagehand } from "../../index";
import { LogLine } from "@/types/log";

/**
 * Evaluates a Zod schema string and returns the actual Zod schema
 * Uses Function constructor to evaluate the schema string in a controlled way
 */
function evaluateZodSchema(
  schemaStr: string,
  logger?: (message: LogLine) => void,
): z.ZodTypeAny {
  try {
    // Create a function that returns the evaluated schema
    // We pass z as a parameter to make it available in the evaluated context
    const schemaFunction = new Function("z", `return ${schemaStr}`);
    return schemaFunction(z);
  } catch (error) {
    logger?.({
      category: "extract",
      message: `Failed to evaluate schema string, using z.any(): ${error}`,
      level: 1,
      auxiliary: {
        error: {
          value: error,
          type: "string",
        },
      },
    });
    return z.any();
  }
}

export const createExtractTool = (
  stagehand: Stagehand,
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
    parameters: z.object({
      instruction: z
        .string()
        .describe(
          "Clear instruction describing what data to extract from the page",
        ),
      schema: z
        .string()
        .describe(
          'Zod schema as a string (e.g., "z.object({ price: z.number() })")',
        ),
    }),
    execute: async ({ instruction, schema }) => {
      try {
        stagehand.logger({
          category: "agent",
          message: `Agent calling tool: extract`,
          level: 1,
          auxiliary: {
            arguments: {
              value: instruction,
              type: "string",
            },
            // TODO: check if we want to log this
            schema: {
              value: schema,
              type: "object",
            },
          },
        });
        // Evaluate the schema string to get the actual Zod schema
        const zodSchema = evaluateZodSchema(schema, logger);

        // Ensure we have a ZodObject
        const schemaObject =
          zodSchema instanceof z.ZodObject
            ? zodSchema
            : z.object({ result: zodSchema });

        // Extract with the schema - only pass modelName if executionModel is explicitly provided
        const result = await stagehand.page.extract({
          instruction,
          schema: schemaObject,
          ...(executionModel && { modelName: executionModel }),
        });

        return {
          success: true,
          data: result,
          timestamp: Date.now(),
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: `Failed to extract data: ${errorMessage}`,
          timestamp: Date.now(),
        };
      }
    },
  });
