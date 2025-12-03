import { z } from "zod";

/**
 * Shared Zod schemas for Stagehand P2P Server API
 * These schemas are used for both runtime validation and OpenAPI generation
 */

// Zod schemas for V3 API (we only support V3 in the library server)
export const actSchemaV3 = z.object({
  input: z.string().or(
    z.object({
      selector: z.string(),
      description: z.string(),
      backendNodeId: z.number().optional(),
      method: z.string().optional(),
      arguments: z.array(z.string()).optional(),
    }),
  ),
  options: z
    .object({
      model: z
        .object({
          provider: z.string().optional(),
          model: z.string().optional(),
          apiKey: z.string().optional(),
          baseURL: z.string().url().optional(),
        })
        .optional(),
      variables: z.record(z.string(), z.string()).optional(),
      timeout: z.number().optional(),
    })
    .optional(),
  frameId: z.string().optional(),
});

export const extractSchemaV3 = z.object({
  instruction: z.string().optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
  options: z
    .object({
      model: z
        .object({
          provider: z.string().optional(),
          model: z.string().optional(),
          apiKey: z.string().optional(),
          baseURL: z.string().url().optional(),
        })
        .optional(),
      timeout: z.number().optional(),
      selector: z.string().optional(),
    })
    .optional(),
  frameId: z.string().optional(),
});

export const observeSchemaV3 = z.object({
  instruction: z.string().optional(),
  options: z
    .object({
      model: z
        .object({
          provider: z.string().optional(),
          model: z.string().optional(),
          apiKey: z.string().optional(),
          baseURL: z.string().url().optional(),
        })
        .optional(),
      timeout: z.number().optional(),
      selector: z.string().optional(),
    })
    .optional(),
  frameId: z.string().optional(),
});

export const agentExecuteSchemaV3 = z.object({
  agentConfig: z.object({
    provider: z.enum(["openai", "anthropic", "google"]).optional(),
    model: z
      .string()
      .optional()
      .or(
        z.object({
          provider: z.enum(["openai", "anthropic", "google"]).optional(),
          modelName: z.string(),
          apiKey: z.string().optional(),
          baseURL: z.string().url().optional(),
        }),
      )
      .optional(),
    systemPrompt: z.string().optional(),
    cua: z.boolean().optional(),
  }),
  executeOptions: z.object({
    instruction: z.string(),
    maxSteps: z.number().optional(),
    highlightCursor: z.boolean().optional(),
  }),
  frameId: z.string().optional(),
});

export const navigateSchemaV3 = z.object({
  url: z.string(),
  options: z
    .object({
      waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
    })
    .optional(),
  frameId: z.string().optional(),
});
