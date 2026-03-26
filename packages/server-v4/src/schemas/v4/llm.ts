import { Api } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

import { TimestampSchema } from "./page.js";

export const LLMIdSchema = z
  .string()
  .min(1)
  .meta({ id: "LLMId", example: "llm_01JXAMPLE" });

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

export const llmErrorResponses = {
  400: LLMErrorResponseSchema,
  401: LLMErrorResponseSchema,
  404: LLMErrorResponseSchema,
  500: LLMErrorResponseSchema,
} as const;

export const LLMSourceSchema = z
  .enum(["user", "system-default"])
  .meta({ id: "LLMSource" });

export const LLMProviderOptionsSchema = z
  .object({
    temperature: z.number().optional(),
    organization: z.string().optional(),
    project: z.string().optional(),
    location: z.string().optional(),
  })
  .strict()
  .meta({ id: "LLMProviderOptions" });

const LLMWritableSchema = z
  .object({
    displayName: z.string().optional(),
    modelName: z.string().meta({
      description: "Provider-prefixed model identifier",
      example: "openai/gpt-4.1-nano",
    }),
    baseUrl: z.string().url().optional(),
    systemPrompt: z.string().optional(),
    providerOptions: LLMProviderOptionsSchema.optional(),
  })
  .strict();

export const LLMCreateRequestSchema = LLMWritableSchema.meta({
  id: "LLMCreateRequest",
});

export const LLMUpdateRequestSchema = LLMWritableSchema.partial().meta({
  id: "LLMUpdateRequest",
});

export const LLMIdParamsSchema = z
  .object({
    id: LLMIdSchema,
  })
  .strict()
  .meta({ id: "LLMIdParams" });

export const LLMSchema = LLMWritableSchema.extend({
  id: LLMIdSchema,
  source: LLMSourceSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
  .strict()
  .meta({ id: "LLM" });

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
