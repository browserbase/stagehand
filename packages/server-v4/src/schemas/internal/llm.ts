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

export const InternalLLMConfigIdSchema = InternalUuidSchema.meta({
  id: "InternalLLMConfigId",
  example: "0195c7c6-7b71-7ed1-8ac5-8f8f7f318cc7",
});

export const InternalLLMChatIdSchema = InternalUuidSchema.meta({
  id: "InternalLLMChatId",
  example: "0195c7c6-7b73-7002-b735-3471f4f0b8b0",
});

export const InternalUIMessageIdSchema = z.string().meta({
  id: "InternalUIMessageId",
  example: "msg_01JXAMPLE",
});

export const InternalBrowserSessionIdSchema = InternalUuidSchema.meta({
  id: "InternalBrowserSessionId",
  example: "0195c7c6-7b77-763e-bf87-efcc5ccf2233",
});

export const InternalBrowserSessionEnvSchema = z
  .enum(["LOCAL", "BROWSERBASE"])
  .meta({ id: "InternalBrowserSessionEnv" });

export const InternalBrowserSessionStatusSchema = z
  .enum(["running", "ended"])
  .meta({ id: "InternalBrowserSessionStatus" });

export const InternalUIMessageRoleSchema = z
  .enum(["system", "user", "assistant"])
  .meta({ id: "InternalUIMessageRole" });

export const InternalLLMProviderOptionsSchema = z
  .record(z.string(), InternalJsonValueSchema)
  .meta({ id: "InternalLLMProviderOptions" });

export const InternalProviderMetadataSchema = z
  .record(z.string(), z.unknown())
  .meta({ id: "InternalProviderMetadata" });

export const InternalUIMessageMetadataSchema = z.unknown().meta({
  id: "InternalUIMessageMetadata",
});

export const InternalUIMessagePartStateSchema = z
  .enum(["streaming", "done"])
  .meta({ id: "InternalUIMessagePartState" });

export const InternalUITextPartSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
    state: InternalUIMessagePartStateSchema.optional(),
  })
  .strict()
  .meta({ id: "InternalUITextPart" });

export const InternalUIReasoningPartSchema = z
  .object({
    type: z.literal("reasoning"),
    text: z.string(),
    state: InternalUIMessagePartStateSchema.optional(),
    providerMetadata: InternalProviderMetadataSchema.optional(),
  })
  .strict()
  .meta({ id: "InternalUIReasoningPart" });

export const InternalUIFilePartSchema = z
  .object({
    type: z.literal("file"),
    mediaType: z.string(),
    filename: z.string().optional(),
    url: z.string(),
  })
  .strict()
  .meta({ id: "InternalUIFilePart" });

export const InternalUISourceUrlPartSchema = z
  .object({
    type: z.literal("source-url"),
    sourceId: z.string(),
    url: z.string(),
    title: z.string().optional(),
    providerMetadata: InternalProviderMetadataSchema.optional(),
  })
  .strict()
  .meta({ id: "InternalUISourceUrlPart" });

export const InternalUISourceDocumentPartSchema = z
  .object({
    type: z.literal("source-document"),
    sourceId: z.string(),
    mediaType: z.string(),
    title: z.string(),
    filename: z.string().optional(),
    providerMetadata: InternalProviderMetadataSchema.optional(),
  })
  .strict()
  .meta({ id: "InternalUISourceDocumentPart" });

const InternalToolTypeSchema = z
  .string()
  .regex(/^tool-.+/)
  .meta({ id: "InternalToolType" });

const InternalDataTypeSchema = z
  .string()
  .regex(/^data-.+/)
  .meta({ id: "InternalDataType" });

export const InternalUIToolPartStateSchema = z
  .enum([
    "input-streaming",
    "input-available",
    "output-available",
    "output-error",
  ])
  .meta({ id: "InternalUIToolPartState" });

export const InternalUIToolInputSchema = z.unknown().meta({
  id: "InternalUIToolInput",
});

export const InternalUIToolOutputSchema = z.unknown().meta({
  id: "InternalUIToolOutput",
});

export const InternalUIToolInputStreamingPartSchema = z
  .object({
    type: InternalToolTypeSchema,
    toolCallId: z.string(),
    state: z.literal("input-streaming"),
    input: InternalUIToolInputSchema.optional(),
    providerExecuted: z.boolean().optional(),
  })
  .strict()
  .meta({ id: "InternalUIToolInputStreamingPart" });

export const InternalUIToolInputAvailablePartSchema = z
  .object({
    type: InternalToolTypeSchema,
    toolCallId: z.string(),
    state: z.literal("input-available"),
    input: InternalUIToolInputSchema,
    providerExecuted: z.boolean().optional(),
  })
  .strict()
  .meta({ id: "InternalUIToolInputAvailablePart" });

export const InternalUIToolOutputAvailablePartSchema = z
  .object({
    type: InternalToolTypeSchema,
    toolCallId: z.string(),
    state: z.literal("output-available"),
    input: InternalUIToolInputSchema,
    output: InternalUIToolOutputSchema,
    providerExecuted: z.boolean().optional(),
  })
  .strict()
  .meta({ id: "InternalUIToolOutputAvailablePart" });

export const InternalUIToolOutputErrorPartSchema = z
  .object({
    type: InternalToolTypeSchema,
    toolCallId: z.string(),
    state: z.literal("output-error"),
    input: InternalUIToolInputSchema,
    errorText: z.string(),
    providerExecuted: z.boolean().optional(),
  })
  .strict()
  .meta({ id: "InternalUIToolOutputErrorPart" });

export const InternalUIToolPartSchema = z
  .union([
    InternalUIToolInputStreamingPartSchema,
    InternalUIToolInputAvailablePartSchema,
    InternalUIToolOutputAvailablePartSchema,
    InternalUIToolOutputErrorPartSchema,
  ])
  .meta({ id: "InternalUIToolPart" });

export const InternalUIDataValueSchema = z.unknown().meta({
  id: "InternalUIDataValue",
});

export const InternalUIDataPartSchema = z
  .object({
    type: InternalDataTypeSchema,
    id: z.string().optional(),
    data: InternalUIDataValueSchema,
  })
  .strict()
  .meta({ id: "InternalUIDataPart" });

export const InternalUIStepStartPartSchema = z
  .object({
    type: z.literal("step-start"),
  })
  .strict()
  .meta({ id: "InternalUIStepStartPart" });

export const InternalUIMessagePartSchema = z
  .union([
    InternalUITextPartSchema,
    InternalUIReasoningPartSchema,
    InternalUIFilePartSchema,
    InternalUISourceUrlPartSchema,
    InternalUISourceDocumentPartSchema,
    InternalUIToolPartSchema,
    InternalUIDataPartSchema,
    InternalUIStepStartPartSchema,
  ])
  .meta({ id: "InternalUIMessagePart" });

// Future DB intent: reusable, project-scoped non-secret LLM config template.
// This row is browser-session independent so one config can be reused across
// multiple sessions within the same project.
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

// Future DB intent: browser sessions remain the Stagehand root and store the
// active/default chat plus per-operation LLM config references directly.
export const InternalBrowserSessionSchema = z
  .object({
    id: InternalBrowserSessionIdSchema,
    projectId: InternalProjectIdSchema,
    env: InternalBrowserSessionEnvSchema,
    status: InternalBrowserSessionStatusSchema,
    browserbaseSessionId: z.string().uuid().nullable(),
    cdpUrl: z.string().nullable(),
    primaryChatId: InternalLLMChatIdSchema,
    defaultLlmConfigId: InternalLLMConfigIdSchema,
    actLlmConfigId: InternalLLMConfigIdSchema.nullable(),
    observeLlmConfigId: InternalLLMConfigIdSchema.nullable(),
    extractLlmConfigId: InternalLLMConfigIdSchema.nullable(),
    createdAt: InternalTimestampSchema,
    updatedAt: InternalTimestampSchema,
    endedAt: InternalTimestampSchema.nullable(),
  })
  .strict()
  .meta({ id: "InternalBrowserSession" });

// Future DB intent: a browser session may own multiple chats, with one primary
// chat referenced from the browser session row.
export const InternalLLMChatSchema = z
  .object({
    id: InternalLLMChatIdSchema,
    projectId: InternalProjectIdSchema,
    browserSessionId: InternalBrowserSessionIdSchema,
    createdAt: InternalTimestampSchema,
    updatedAt: InternalTimestampSchema,
    lastMessageAt: InternalTimestampSchema.nullable(),
  })
  .strict()
  .meta({ id: "InternalLLMChat" });

// Future DB intent: persisted AI-SDK-style chat messages. Messages are stored
// as ordered parts plus optional metadata so we can later convert them into the
// model-specific message format we send to the LLM.
export const InternalUIMessageSchema = z
  .object({
    id: InternalUIMessageIdSchema,
    projectId: InternalProjectIdSchema,
    chatId: InternalLLMChatIdSchema,
    role: InternalUIMessageRoleSchema,
    parts: z.array(InternalUIMessagePartSchema),
    metadata: InternalUIMessageMetadataSchema.optional(),
    sequence: z.number().int().nonnegative(),
    createdAt: InternalTimestampSchema,
  })
  .strict()
  .meta({ id: "InternalUIMessage" });

export type InternalLLMConfig = z.infer<typeof InternalLLMConfigSchema>;
export type InternalBrowserSession = z.infer<
  typeof InternalBrowserSessionSchema
>;
export type InternalLLMChat = z.infer<typeof InternalLLMChatSchema>;
export type InternalUIMessage = z.infer<typeof InternalUIMessageSchema>;

export function resolveInternalLLMConfigId(
  browserSession: Pick<
    InternalBrowserSession,
    | "defaultLlmConfigId"
    | "actLlmConfigId"
    | "observeLlmConfigId"
    | "extractLlmConfigId"
  >,
  operation: "act" | "observe" | "extract",
): string {
  if (operation === "act") {
    return browserSession.actLlmConfigId ?? browserSession.defaultLlmConfigId;
  }

  if (operation === "observe") {
    return (
      browserSession.observeLlmConfigId ?? browserSession.defaultLlmConfigId
    );
  }

  return browserSession.extractLlmConfigId ?? browserSession.defaultLlmConfigId;
}
