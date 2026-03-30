import { z } from "zod/v4";

import {
  DatabaseJsonValueSchema,
  DatabaseTimestampSchema,
  llmCallSelectSchema,
  llmSessionSelectSchema,
  llmSessionStatusSchema,
  stagehandBrowserSessionSelectSchema,
  stagehandBrowserSessionStatusSchema,
  stagehandStepOperationSchema,
  stagehandStepSelectSchema,
} from "../../db/schema/zod.js";

export type InternalJsonValue = z.infer<typeof DatabaseJsonValueSchema>;

export const InternalJsonValueSchema = DatabaseJsonValueSchema.meta({
  id: "InternalJsonValue",
});

export const InternalTimestampSchema = DatabaseTimestampSchema.meta({
  id: "InternalTimestamp",
  example: "2026-02-03T12:00:00.000Z",
});

export const InternalProjectIdSchema =
  llmSessionSelectSchema.shape.projectId.meta({
    id: "InternalProjectId",
    example: "550e8400-e29b-41d4-a716-446655440000",
  });

export const InternalLLMSessionIdSchema = llmSessionSelectSchema.shape.id.meta({
  id: "InternalLLMSessionId",
  example: "0195c7c6-7b73-7002-b735-3471f4f0b8b0",
});

export const InternalLLMCallIdSchema = llmCallSelectSchema.shape.id.meta({
  id: "InternalLLMCallId",
  example: "0195c7c6-7b74-75df-b8b4-42e50979d001",
});

export const InternalStagehandBrowserSessionIdSchema =
  stagehandBrowserSessionSelectSchema.shape.id.meta({
    id: "InternalStagehandBrowserSessionId",
    example: "0195c7c6-7b75-7e9e-98a2-f3b999c4aa11",
  });

export const InternalStagehandStepIdSchema =
  stagehandStepSelectSchema.shape.id.meta({
    id: "InternalStagehandStepId",
    example: "0195c7c6-7b76-7db4-8128-445ea7c81122",
  });

export const InternalLLMSessionStatusSchema = llmSessionStatusSchema.meta({
  id: "InternalLLMSessionStatus",
});

export const InternalStagehandBrowserSessionStatusSchema =
  stagehandBrowserSessionStatusSchema.meta({
    id: "InternalStagehandBrowserSessionStatus",
  });

export const InternalStagehandStepOperationSchema =
  stagehandStepOperationSchema.meta({
    id: "InternalStagehandStepOperation",
  });

export const InternalLLMSessionSchema = llmSessionSelectSchema.meta({
  id: "InternalLLMSession",
});

export const InternalLLMCallSchema = llmCallSelectSchema.meta({
  id: "InternalLLMCall",
});

export const InternalStagehandBrowserSessionSchema =
  stagehandBrowserSessionSelectSchema.meta({
    id: "InternalStagehandBrowserSession",
  });

export const InternalStagehandStepSchema = stagehandStepSelectSchema.meta({
  id: "InternalStagehandStep",
});

export type InternalLLMSession = z.infer<typeof InternalLLMSessionSchema>;
export type InternalLLMCall = z.infer<typeof InternalLLMCallSchema>;
export type InternalStagehandBrowserSession = z.infer<
  typeof InternalStagehandBrowserSessionSchema
>;
export type InternalStagehandStep = z.infer<typeof InternalStagehandStepSchema>;
