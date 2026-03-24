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

export const InternalTimestampSchema = z
  .string()
  .datetime()
  .meta({
    id: "InternalTimestamp",
    example: "2026-02-03T12:00:00.000Z",
  });

export const InternalProjectIdSchema = InternalUuidSchema.meta({
  id: "InternalProjectId",
  example: "550e8400-e29b-41d4-a716-446655440000",
});

export const InternalLLMConfigIdSchema = InternalUuidSchema.meta({
  id: "InternalLLMConfigId",
  example: "0195c7c6-7b71-7ed1-8ac5-8f8f7f318cc7",
});

export const InternalLLMConfigSetIdSchema = InternalUuidSchema.meta({
  id: "InternalLLMConfigSetId",
  example: "0195c7c6-7b72-7339-91d0-b42c0339f0af",
});

export const InternalLLMChatIdSchema = InternalUuidSchema.meta({
  id: "InternalLLMChatId",
  example: "0195c7c6-7b73-7002-b735-3471f4f0b8b0",
});

export const InternalStagehandStepIdSchema = InternalUuidSchema.meta({
  id: "InternalStagehandStepId",
  example: "0195c7c6-7b74-75df-b8b4-42e50979d001",
});

export const InternalLLMMessageIdSchema = InternalUuidSchema.meta({
  id: "InternalLLMMessageId",
  example: "0195c7c6-7b75-7e9e-98a2-f3b999c4aa11",
});

export const InternalLLMCallIdSchema = InternalUuidSchema.meta({
  id: "InternalLLMCallId",
  example: "0195c7c6-7b76-7db4-8128-445ea7c81122",
});

export const InternalStagehandBrowserSessionIdSchema = InternalUuidSchema.meta({
  id: "InternalStagehandBrowserSessionId",
  example: "0195c7c6-7b77-763e-bf87-efcc5ccf2233",
});

export const InternalBrowserSessionEnvSchema = z
  .enum(["LOCAL", "BROWSERBASE"])
  .meta({ id: "InternalBrowserSessionEnv" });

export const InternalBrowserSessionStatusSchema = z
  .enum(["running", "ended"])
  .meta({ id: "InternalBrowserSessionStatus" });

export const InternalLLMOperationSchema = z
  .enum(["act", "observe", "extract"])
  .meta({ id: "InternalLLMOperation" });

export const InternalLLMChatStatusSchema = z
  .enum(["idle", "thinking", "errored"])
  .meta({ id: "InternalLLMChatStatus" });

export const InternalStagehandStepStatusSchema = z
  .enum(["queued", "running", "completed", "failed", "canceled"])
  .meta({ id: "InternalStagehandStepStatus" });

export const InternalLLMMessageRoleSchema = z
  .enum(["system", "developer", "user", "assistant", "tool"])
  .meta({ id: "InternalLLMMessageRole" });

export const InternalLLMProviderOptionsSchema = z
  .record(z.string(), InternalJsonValueSchema)
  .meta({ id: "InternalLLMProviderOptions" });

export const InternalHttpHeadersSchema = z
  .record(z.string(), z.string())
  .meta({ id: "InternalHttpHeaders" });

// Future DB intent: reusable, project-scoped non-secret LLM config template.
// This row is intentionally browser-session independent so one config can be
// reused by multiple sessions and config sets within the same project.
export const InternalLLMConfigSchema = z
  .object({
    id: InternalLLMConfigIdSchema,
    projectId: InternalProjectIdSchema,
    displayName: z.string().nullable(),
    modelName: z.string(),
    baseUrl: z.string().url().nullable(),
    systemPrompt: z.string().nullable(),
    providerOptions: InternalLLMProviderOptionsSchema.nullable(),
    createdAt: InternalTimestampSchema,
    updatedAt: InternalTimestampSchema,
  })
  .strict()
  .meta({ id: "InternalLLMConfig" });

// Future DB intent: immutable snapshot columns copied onto a chat when a
// resolved config is attached. Existing chats must not change if the source
// config row is later edited.
export const InternalLLMConfigSnapshotSchema = z
  .object({
    modelName: z.string(),
    baseUrl: z.string().url().nullable(),
    systemPrompt: z.string().nullable(),
    providerOptions: InternalLLMProviderOptionsSchema.nullable(),
  })
  .strict()
  .meta({ id: "InternalLLMConfigSnapshot" });

// Future DB intent: operation-aware default config resolution owned by the
// browser session. Operation-specific slots fall back to defaultConfigId.
// All referenced config IDs are expected to belong to the same project.
export const InternalLLMConfigSetSchema = z
  .object({
    id: InternalLLMConfigSetIdSchema,
    projectId: InternalProjectIdSchema,
    defaultConfigId: InternalLLMConfigIdSchema,
    actConfigId: InternalLLMConfigIdSchema.nullable(),
    observeConfigId: InternalLLMConfigIdSchema.nullable(),
    extractConfigId: InternalLLMConfigIdSchema.nullable(),
    createdAt: InternalTimestampSchema,
    updatedAt: InternalTimestampSchema,
  })
  .strict()
  .meta({ id: "InternalLLMConfigSet" });

// Future DB intent: durable browser-session-scoped chat/thread with copied
// config snapshot columns. Current behavior is one chat per step, but the chat
// row is intentionally modeled to support multi-step threads later.
export const InternalLLMChatSchema = z
  .object({
    id: InternalLLMChatIdSchema,
    projectId: InternalProjectIdSchema,
    browserSessionId: InternalStagehandBrowserSessionIdSchema,
    sourceConfigId: InternalLLMConfigIdSchema.nullable(),
    forkedFromChatId: InternalLLMChatIdSchema.nullable(),
    status: InternalLLMChatStatusSchema,
    createdAt: InternalTimestampSchema,
    updatedAt: InternalTimestampSchema,
    lastMessageAt: InternalTimestampSchema.nullable(),
    lastErrorAt: InternalTimestampSchema.nullable(),
  })
  .extend(InternalLLMConfigSnapshotSchema.shape)
  .strict()
  .meta({ id: "InternalLLMChat" });

// Future DB intent: execution unit for act/observe/extract. Config can be
// requested explicitly or resolved via the browser session's default config set.
// Raw provider calls belong primarily to this row.
export const InternalStagehandStepSchema = z
  .object({
    id: InternalStagehandStepIdSchema,
    projectId: InternalProjectIdSchema,
    browserSessionId: InternalStagehandBrowserSessionIdSchema,
    chatId: InternalLLMChatIdSchema,
    operation: InternalLLMOperationSchema,
    configSetId: InternalLLMConfigSetIdSchema.nullable(),
    requestedConfigId: InternalLLMConfigIdSchema.nullable(),
    resolvedConfigId: InternalLLMConfigIdSchema.nullable(),
    params: InternalJsonValueSchema,
    result: InternalJsonValueSchema.nullable(),
    status: InternalStagehandStepStatusSchema,
    createdAt: InternalTimestampSchema,
    updatedAt: InternalTimestampSchema,
    completedAt: InternalTimestampSchema.nullable(),
  })
  .strict()
  .meta({ id: "InternalStagehandStep" });

// Future DB intent: normalized message history for a chat. Messages belong to
// the chat and optionally point back to the step that appended them so later
// multi-step threads remain queryable by either dimension.
export const InternalLLMMessageSchema = z
  .object({
    id: InternalLLMMessageIdSchema,
    projectId: InternalProjectIdSchema,
    chatId: InternalLLMChatIdSchema,
    stepId: InternalStagehandStepIdSchema.nullable(),
    role: InternalLLMMessageRoleSchema,
    content: InternalJsonValueSchema,
    sequence: z.number().int().nonnegative(),
    createdAt: InternalTimestampSchema,
  })
  .strict()
  .meta({ id: "InternalLLMMessage" });

// Future DB intent: raw provider request/response audit row. Headers, if
// stored, are expected to be redacted before persistence since auth stays
// request-scoped and should not be stored in config rows.
export const InternalLLMCallSchema = z
  .object({
    id: InternalLLMCallIdSchema,
    projectId: InternalProjectIdSchema,
    stepId: InternalStagehandStepIdSchema,
    chatId: InternalLLMChatIdSchema.nullable(),
    requestHeaders: InternalHttpHeadersSchema.nullable(),
    requestBody: InternalJsonValueSchema.nullable(),
    responseBody: InternalJsonValueSchema.nullable(),
    errorBody: InternalJsonValueSchema.nullable(),
    usage: InternalJsonValueSchema.nullable(),
    modelName: z.string(),
    startedAt: InternalTimestampSchema,
    completedAt: InternalTimestampSchema.nullable(),
  })
  .strict()
  .meta({ id: "InternalLLMCall" });

// Future DB intent: browser session remains the owner of default config
// selection via defaultConfigSetId. It should not point directly to a default
// chat because chats are execution/thread state, not reusable config state.
export const InternalStagehandBrowserSessionSchema = z
  .object({
    id: InternalStagehandBrowserSessionIdSchema,
    projectId: InternalProjectIdSchema,
    env: InternalBrowserSessionEnvSchema,
    status: InternalBrowserSessionStatusSchema,
    browserbaseSessionId: z.string().uuid().nullable(),
    cdpUrl: z.string().nullable(),
    defaultConfigSetId: InternalLLMConfigSetIdSchema,
    createdAt: InternalTimestampSchema,
    updatedAt: InternalTimestampSchema,
    endedAt: InternalTimestampSchema.nullable(),
  })
  .strict()
  .meta({ id: "InternalStagehandBrowserSession" });

export type InternalLLMConfig = z.infer<typeof InternalLLMConfigSchema>;
export type InternalLLMConfigSet = z.infer<typeof InternalLLMConfigSetSchema>;
export type InternalLLMChat = z.infer<typeof InternalLLMChatSchema>;
export type InternalStagehandStep = z.infer<typeof InternalStagehandStepSchema>;
export type InternalLLMMessage = z.infer<typeof InternalLLMMessageSchema>;
export type InternalLLMCall = z.infer<typeof InternalLLMCallSchema>;
export type InternalStagehandBrowserSession = z.infer<
  typeof InternalStagehandBrowserSessionSchema
>;
export type InternalLLMOperation = z.infer<typeof InternalLLMOperationSchema>;

export function resolveInternalLLMConfigId(
  configSet: InternalLLMConfigSet,
  operation: InternalLLMOperation,
): string {
  if (operation === "act") {
    return configSet.actConfigId ?? configSet.defaultConfigId;
  }

  if (operation === "observe") {
    return configSet.observeConfigId ?? configSet.defaultConfigId;
  }

  return configSet.extractConfigId ?? configSet.defaultConfigId;
}

function cloneInternalJsonValue(
  value: InternalJsonValue | null,
): InternalJsonValue | null {
  if (value === null) {
    return null;
  }

  return JSON.parse(JSON.stringify(value)) as InternalJsonValue;
}

export function buildInternalLLMConfigSnapshot(
  config: Pick<
    InternalLLMConfig,
    "modelName" | "baseUrl" | "systemPrompt" | "providerOptions"
  >,
): z.infer<typeof InternalLLMConfigSnapshotSchema> {
  return InternalLLMConfigSnapshotSchema.parse({
    modelName: config.modelName,
    baseUrl: config.baseUrl,
    systemPrompt: config.systemPrompt,
    providerOptions: cloneInternalJsonValue(config.providerOptions),
  });
}
