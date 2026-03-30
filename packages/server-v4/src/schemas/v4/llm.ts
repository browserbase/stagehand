import { Api } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

import {
  LLMProviderOptionsSchema as DatabaseLLMProviderOptionsSchema,
  llmConfigInsertSchema,
  llmConfigSelectSchema,
  llmConfigUpdateSchema,
  llmSourceSchema as DatabaseLLMSourceSchema,
} from "../../db/schema/zod.js";

export const LLMIdSchema = llmConfigSelectSchema.shape.id.meta({
  id: "LLMId",
  example: "550e8400-e29b-41d4-a716-446655440000",
});

export const LLMHeadersSchema = Api.SessionHeadersSchema.meta({
  id: "LLMHeaders",
});

export const LLMErrorResponseSchema = z
  .object({
    success: z.literal(false),
    message: z.string(),
  })
  .strict()
  .meta({ id: "LLMErrorResponse" });

export const LLMSourceSchema = DatabaseLLMSourceSchema.meta({
  id: "LLMSource",
});

export const LLMProviderOptionsSchema = DatabaseLLMProviderOptionsSchema.meta({
  id: "LLMProviderOptions",
});

export const LLMCreateRequestSchema = llmConfigInsertSchema
  .omit({
    id: true,
    source: true,
    createdAt: true,
    updatedAt: true,
  })
  .meta({
    id: "LLMCreateRequest",
  });

export const LLMUpdateRequestSchema = llmConfigUpdateSchema
  .omit({
    id: true,
    source: true,
    createdAt: true,
    updatedAt: true,
  })
  .meta({
    id: "LLMUpdateRequest",
  });

export const LLMIdParamsSchema = z
  .object({
    id: LLMIdSchema,
  })
  .strict()
  .meta({ id: "LLMIdParams" });

export const LLMSchema = llmConfigSelectSchema.meta({ id: "LLM" });

export const LLMResultSchema = z
  .object({
    llm: LLMSchema,
  })
  .strict()
  .meta({ id: "LLMResult" });

export const LLMResponseSchema = z
  .object({
    success: z.literal(true),
    data: LLMResultSchema,
  })
  .strict()
  .meta({ id: "LLMResponse" });

export const LLMListResultSchema = z
  .object({
    llms: z.array(LLMSchema),
  })
  .strict()
  .meta({ id: "LLMListResult" });

export const LLMListResponseSchema = z
  .object({
    success: z.literal(true),
    data: LLMListResultSchema,
  })
  .strict()
  .meta({ id: "LLMListResponse" });

export const llmOpenApiComponents = {
  schemas: {
    LLMId: LLMIdSchema,
    LLMHeaders: LLMHeadersSchema,
    LLMErrorResponse: LLMErrorResponseSchema,
    LLMSource: LLMSourceSchema,
    LLMProviderOptions: LLMProviderOptionsSchema,
    LLMCreateRequest: LLMCreateRequestSchema,
    LLMUpdateRequest: LLMUpdateRequestSchema,
    LLMIdParams: LLMIdParamsSchema,
    LLM: LLMSchema,
    LLMResult: LLMResultSchema,
    LLMResponse: LLMResponseSchema,
    LLMListResult: LLMListResultSchema,
    LLMListResponse: LLMListResponseSchema,
  },
};

export type LLM = z.infer<typeof LLMSchema>;
export type LLMCreateRequest = z.infer<typeof LLMCreateRequestSchema>;
export type LLMUpdateRequest = z.infer<typeof LLMUpdateRequestSchema>;
export type LLMIdParams = z.infer<typeof LLMIdParamsSchema>;

export function buildLLMErrorResponse(message: string) {
  return LLMErrorResponseSchema.parse({
    success: false,
    message,
  });
}
