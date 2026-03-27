import { z } from "zod/v4";

export type InternalJsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: InternalJsonValue }
  | InternalJsonValue[];

export const InternalJsonValueSchema: z.ZodType<InternalJsonValue> = z.lazy(
  () =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(InternalJsonValueSchema),
      z.record(z.string(), InternalJsonValueSchema),
    ]),
);

const InternalUuidSchema = z.string().uuid();

export const InternalTimestampSchema = z.string().datetime().meta({
  id: "InternalTimestamp",
  example: "2026-02-03T12:00:00.000Z",
});

export const InternalProjectIdSchema = InternalUuidSchema.meta({
  id: "InternalProjectId",
  example: "550e8400-e29b-41d4-a716-446655440000",
});

export const InternalLLMSessionIdSchema = InternalUuidSchema.meta({
  id: "InternalLLMSessionId",
  example: "0195c7c6-7b73-7002-b735-3471f4f0b8b0",
});

export const InternalLLMCallIdSchema = InternalUuidSchema.meta({
  id: "InternalLLMCallId",
  example: "0195c7c6-7b74-75df-b8b4-42e50979d001",
});

export const InternalStagehandBrowserSessionIdSchema = InternalUuidSchema.meta({
  id: "InternalStagehandBrowserSessionId",
  example: "0195c7c6-7b75-7e9e-98a2-f3b999c4aa11",
});

export const InternalStagehandStepIdSchema = InternalUuidSchema.meta({
  id: "InternalStagehandStepId",
  example: "0195c7c6-7b76-7db4-8128-445ea7c81122",
});

export const InternalLLMSessionStatusSchema = z
  .enum(["disconnected", "idle", "thinking", "permanent-error", "ratelimited"])
  .meta({ id: "InternalLLMSessionStatus" });

export const InternalStagehandBrowserSessionStatusSchema = z
  .enum(["running", "terminated"])
  .meta({ id: "InternalStagehandBrowserSessionStatus" });

export const InternalStagehandStepOperationSchema = z
  .enum(["act", "extract", "observe", "agent"])
  .meta({ id: "InternalStagehandStepOperation" });

// Future DB intent: LLM sessions are the internal source-of-truth for a single
// config-bearing LLM thread. A session may be copied from a template session or
// forked from a parent session that contributes prior conversation state.
export const InternalLLMSessionSchema = z
  .object({
    id: InternalLLMSessionIdSchema,
    copiedTemplateId: InternalLLMSessionIdSchema.nullable(),
    forkedSessionId: InternalLLMSessionIdSchema.nullable(),
    projectId: InternalProjectIdSchema,
    browserSessionId: InternalStagehandBrowserSessionIdSchema,
    createdAt: InternalTimestampSchema,
    updatedAt: InternalTimestampSchema,
    connectedAt: InternalTimestampSchema.nullable(),
    disconnectedAt: InternalTimestampSchema.nullable(),
    lastRequestAt: InternalTimestampSchema.nullable(),
    lastResponseAt: InternalTimestampSchema.nullable(),
    lastErrorAt: InternalTimestampSchema.nullable(),
    lastErrorMessage: z.string().nullable(),
    status: InternalLLMSessionStatusSchema,
    model: z.string().meta({
      description: "Provider-prefixed model identifier",
      example: "openai/gpt-5-nano",
    }),
    baseUrl: z.url().nullable(),
    options: InternalJsonValueSchema.nullable(),
    extraHttpHeaders: z.record(z.string(), z.string()).nullable(),
    systemPrompt: z.string().nullable(),
    tokensInput: z.number().int().nonnegative(),
    tokensOutput: z.number().int().nonnegative(),
    tokensReasoning: z.number().int().nonnegative(),
    tokensCachedInput: z.number().int().nonnegative(),
    tokensTotal: z.number().int().nonnegative(),
  })
  .strict()
  .meta({ id: "InternalLLMSession" });

// Future DB intent: each provider exchange is stored as a single row rather
// than split request/response tables. This keeps the call log append-friendly
// while still supporting ordering, usage accounting, and error capture.
export const InternalLLMCallSchema = z
  .object({
    id: InternalLLMCallIdSchema,
    llmSessionId: InternalLLMSessionIdSchema,
    sentAt: InternalTimestampSchema,
    receivedAt: InternalTimestampSchema.nullable(),
    prompt: z.string(),
    expectedResponseSchema: InternalJsonValueSchema.nullable(),
    response: InternalJsonValueSchema.nullable(),
    error: InternalJsonValueSchema.nullable(),
    usage: InternalJsonValueSchema.nullable(),
    model: z.string().meta({
      description:
        "Redundant model snapshot for query efficiency even though it can be derived from llmSessionId",
      example: "openai/gpt-5-nano",
    }),
  })
  .strict()
  .meta({ id: "InternalLLMCall" });

// Future DB intent: browser session is the Stagehand root and points at the
// default LLM session/template used to derive per-step threads.
export const InternalStagehandBrowserSessionSchema = z
  .object({
    id: InternalStagehandBrowserSessionIdSchema,
    projectId: InternalProjectIdSchema,
    browserbaseSessionId: InternalStagehandBrowserSessionIdSchema.nullable(),
    cdpUrl: z.string(),
    status: InternalStagehandBrowserSessionStatusSchema,
    defaultLLMSessionId: InternalLLMSessionIdSchema,
  })
  .strict()
  .meta({ id: "InternalStagehandBrowserSession" });

// Future DB intent: a Stagehand step resolves an LLM template and hydrates a
// dedicated llmSessionId for exclusive use by that step. The comments in the
// design doc about helper methods are explanatory only; only row shape lives
// here.
export const InternalStagehandStepSchema = z
  .object({
    id: InternalStagehandStepIdSchema,
    stagehandBrowserSessionId: InternalStagehandBrowserSessionIdSchema,
    operation: InternalStagehandStepOperationSchema,
    llmTemplateId: InternalLLMSessionIdSchema,
    llmSessionId: InternalLLMSessionIdSchema.nullable(),
    params: InternalJsonValueSchema,
    result: InternalJsonValueSchema.nullable(),
  })
  .strict()
  .meta({ id: "InternalStagehandStep" });

export type InternalLLMSession = z.infer<typeof InternalLLMSessionSchema>;
export type InternalLLMCall = z.infer<typeof InternalLLMCallSchema>;
export type InternalStagehandBrowserSession = z.infer<
  typeof InternalStagehandBrowserSessionSchema
>;
export type InternalStagehandStep = z.infer<typeof InternalStagehandStepSchema>;
