import { tool } from "ai";
import { z, ZodTypeAny } from "zod";
import type { V3 } from "../../v3.js";
import type { AgentModelConfig } from "../../types/public/agent.js";

interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: string[];
  format?: "url" | "email" | "uuid";
}

function jsonSchemaToZod(schema: JsonSchema): ZodTypeAny {
  switch (schema.type) {
    case "object": {
      const shape: Record<string, ZodTypeAny> = {};
      if (schema.properties) {
        for (const [key, value] of Object.entries(schema.properties)) {
          shape[key] = jsonSchemaToZod(value);
        }
      }
      return z.object(shape);
    }
    case "array":
      return z.array(schema.items ? jsonSchemaToZod(schema.items) : z.any());
    case "string": {
      let s = z.string();
      if (schema.format === "url") s = s.url();
      if (schema.format === "email") s = s.email();
      if (schema.format === "uuid") s = s.uuid();
      if (schema.enum && schema.enum.length > 0)
        return z.enum(schema.enum as [string, ...string[]]);
      return s;
    }
    case "number":
    case "integer":
      return z.number();
    case "boolean":
      return z.boolean();
    case "null":
      return z.null();
    default:
      return z.any();
  }
}

export const extractTool = (
  v3: V3,
  executionModel?: string | AgentModelConfig,
) =>
  tool({
    description: `Extract structured data from the current page based on a provided schema.
    
    USAGE GUIDELINES:
    - Keep schemas MINIMAL - only include fields essential for the task
    - IMPORTANT: only use this if explicitly asked for structured output. In most scenarios, you should use the aria tree tool over this.
    - For URL fields, use format: "url"
    
    EXAMPLES:
    1. Extract a single value:
       instruction: "extract the product price"
       schema: { type: "object", properties: { price: { type: "number" } } }
    
    2. Extract multiple fields:
       instruction: "extract product name and price"
       schema: { type: "object", properties: { name: { type: "string" }, price: { type: "number" } } }
    
    3. Extract arrays:
       instruction: "extract all product names and prices"
       schema: { type: "object", properties: { products: { type: "array", items: { type: "object", properties: { name: { type: "string" }, price: { type: "number" } } } } } }
    
    4. Extract a URL:
       instruction: "extract the link"
       schema: { type: "object", properties: { url: { type: "string", format: "url" } } }`,
    inputSchema: z.object({
      instruction: z.string(),
      schema: z
        .object({
          type: z.string().optional(),
          properties: z.record(z.string(), z.unknown()).optional(),
          items: z.unknown().optional(),
          enum: z.array(z.string()).optional(),
          format: z.enum(["url", "email", "uuid"]).optional(),
        })
        .passthrough()
        .optional()
        .describe("JSON Schema object describing the structure to extract"),
    }),
    execute: async ({ instruction, schema }) => {
      try {
        const parsedSchema = schema
          ? jsonSchemaToZod(schema as JsonSchema)
          : undefined;
        const result = await v3.extract(instruction, parsedSchema, {
          ...(executionModel ? { model: executionModel } : {}),
        });
        return { success: true, result };
      } catch (error) {
        const err = error as Error;
        return { success: false, error: err?.message ?? String(error) };
      }
    },
  });
