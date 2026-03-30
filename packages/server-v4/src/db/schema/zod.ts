import { createSchemaFactory } from "drizzle-orm/zod";
import { z } from "zod/v4";
import { llmCallsTable } from "./llmCalls.js";
import { llmConfigsTable, llmSourceEnum } from "./llmConfigs.js";
import { llmSessionStatusEnum, llmSessionsTable } from "./llmSessions.js";
import {
  stagehandBrowserSessionStatusEnum,
  stagehandBrowserSessionsTable,
} from "./stagehandBrowserSessions.js";
import {
  stagehandStepOperationEnum,
  stagehandStepsTable,
} from "./stagehandSteps.js";
import type { DatabaseJsonValue, ExtraHttpHeaders } from "./types.js";

export const DatabaseJsonValueSchema: z.ZodType<DatabaseJsonValue> = z.lazy(
  () =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(DatabaseJsonValueSchema),
      z.record(z.string(), DatabaseJsonValueSchema),
    ]),
);

export const DatabaseTimestampSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid timestamp",
  });

export const LLMProviderOptionsSchema = z
  .object({
    temperature: z.number().optional(),
    organization: z.string().optional(),
    project: z.string().optional(),
    location: z.string().optional(),
  })
  .strict();

export const ExtraHttpHeadersSchema: z.ZodType<ExtraHttpHeaders> = z.record(
  z.string(),
  z.string(),
);

const { createInsertSchema, createSelectSchema, createUpdateSchema } =
  createSchemaFactory({
    zodInstance: z,
  });

export const llmSourceSchema = createSelectSchema(llmSourceEnum);
export const llmSessionStatusSchema = createSelectSchema(llmSessionStatusEnum);
export const stagehandBrowserSessionStatusSchema = createSelectSchema(
  stagehandBrowserSessionStatusEnum,
);
export const stagehandStepOperationSchema = createSelectSchema(
  stagehandStepOperationEnum,
);

export const llmConfigSelectSchema = createSelectSchema(llmConfigsTable, {
  id: z.uuid(),
  baseUrl: z.url().nullable(),
  providerOptions: LLMProviderOptionsSchema.nullable(),
  createdAt: DatabaseTimestampSchema,
  updatedAt: DatabaseTimestampSchema,
}).strict();

export const llmConfigInsertSchema = createInsertSchema(llmConfigsTable, {
  id: z.uuid().optional(),
  source: llmSourceSchema.optional(),
  baseUrl: z.url().nullable().optional(),
  providerOptions: LLMProviderOptionsSchema.nullable().optional(),
  createdAt: DatabaseTimestampSchema.optional(),
  updatedAt: DatabaseTimestampSchema.optional(),
}).strict();

export const llmConfigUpdateSchema = createUpdateSchema(llmConfigsTable, {
  id: z.uuid().optional(),
  source: llmSourceSchema.optional(),
  baseUrl: z.url().nullable().optional(),
  providerOptions: LLMProviderOptionsSchema.nullable().optional(),
  createdAt: DatabaseTimestampSchema.optional(),
  updatedAt: DatabaseTimestampSchema.optional(),
}).strict();

export const llmSessionSelectSchema = createSelectSchema(llmSessionsTable, {
  id: z.uuid(),
  copiedTemplateId: z.uuid().nullable(),
  forkedSessionId: z.uuid().nullable(),
  projectId: z.uuid(),
  browserSessionId: z.uuid().nullable(),
  createdAt: DatabaseTimestampSchema,
  updatedAt: DatabaseTimestampSchema,
  connectedAt: DatabaseTimestampSchema.nullable(),
  disconnectedAt: DatabaseTimestampSchema.nullable(),
  lastRequestAt: DatabaseTimestampSchema.nullable(),
  lastResponseAt: DatabaseTimestampSchema.nullable(),
  lastErrorAt: DatabaseTimestampSchema.nullable(),
  options: DatabaseJsonValueSchema.nullable(),
  extraHttpHeaders: ExtraHttpHeadersSchema.nullable(),
  baseUrl: z.url().nullable(),
}).strict();

export const llmSessionInsertSchema = createInsertSchema(llmSessionsTable, {
  id: z.uuid().optional(),
  copiedTemplateId: z.uuid().nullable().optional(),
  forkedSessionId: z.uuid().nullable().optional(),
  projectId: z.uuid(),
  browserSessionId: z.uuid().nullable().optional(),
  createdAt: DatabaseTimestampSchema.optional(),
  updatedAt: DatabaseTimestampSchema.optional(),
  connectedAt: DatabaseTimestampSchema.nullable().optional(),
  disconnectedAt: DatabaseTimestampSchema.nullable().optional(),
  lastRequestAt: DatabaseTimestampSchema.nullable().optional(),
  lastResponseAt: DatabaseTimestampSchema.nullable().optional(),
  lastErrorAt: DatabaseTimestampSchema.nullable().optional(),
  options: DatabaseJsonValueSchema.nullable().optional(),
  extraHttpHeaders: ExtraHttpHeadersSchema.nullable().optional(),
  baseUrl: z.url().nullable().optional(),
}).strict();

export const llmSessionUpdateSchema = createUpdateSchema(llmSessionsTable, {
  id: z.uuid().optional(),
  copiedTemplateId: z.uuid().nullable().optional(),
  forkedSessionId: z.uuid().nullable().optional(),
  projectId: z.uuid().optional(),
  browserSessionId: z.uuid().nullable().optional(),
  createdAt: DatabaseTimestampSchema.optional(),
  updatedAt: DatabaseTimestampSchema.optional(),
  connectedAt: DatabaseTimestampSchema.nullable().optional(),
  disconnectedAt: DatabaseTimestampSchema.nullable().optional(),
  lastRequestAt: DatabaseTimestampSchema.nullable().optional(),
  lastResponseAt: DatabaseTimestampSchema.nullable().optional(),
  lastErrorAt: DatabaseTimestampSchema.nullable().optional(),
  options: DatabaseJsonValueSchema.nullable().optional(),
  extraHttpHeaders: ExtraHttpHeadersSchema.nullable().optional(),
  baseUrl: z.url().nullable().optional(),
}).strict();

export const llmCallSelectSchema = createSelectSchema(llmCallsTable, {
  id: z.uuid(),
  llmSessionId: z.uuid(),
  sentAt: DatabaseTimestampSchema,
  receivedAt: DatabaseTimestampSchema.nullable(),
  expectedResponseSchema: DatabaseJsonValueSchema.nullable(),
  response: DatabaseJsonValueSchema.nullable(),
  error: DatabaseJsonValueSchema.nullable(),
  usage: DatabaseJsonValueSchema.nullable(),
}).strict();

export const llmCallInsertSchema = createInsertSchema(llmCallsTable, {
  id: z.uuid().optional(),
  llmSessionId: z.uuid(),
  sentAt: DatabaseTimestampSchema.optional(),
  receivedAt: DatabaseTimestampSchema.nullable().optional(),
  expectedResponseSchema: DatabaseJsonValueSchema.nullable().optional(),
  response: DatabaseJsonValueSchema.nullable().optional(),
  error: DatabaseJsonValueSchema.nullable().optional(),
  usage: DatabaseJsonValueSchema.nullable().optional(),
}).strict();

export const llmCallUpdateSchema = createUpdateSchema(llmCallsTable, {
  id: z.uuid().optional(),
  llmSessionId: z.uuid().optional(),
  sentAt: DatabaseTimestampSchema.optional(),
  receivedAt: DatabaseTimestampSchema.nullable().optional(),
  expectedResponseSchema: DatabaseJsonValueSchema.nullable().optional(),
  response: DatabaseJsonValueSchema.nullable().optional(),
  error: DatabaseJsonValueSchema.nullable().optional(),
  usage: DatabaseJsonValueSchema.nullable().optional(),
}).strict();

export const stagehandBrowserSessionSelectSchema = createSelectSchema(
  stagehandBrowserSessionsTable,
  {
    id: z.uuid(),
    projectId: z.uuid(),
    browserbaseSessionId: z.uuid().nullable(),
    defaultLLMSessionId: z.uuid(),
  },
).strict();

export const stagehandBrowserSessionInsertSchema = createInsertSchema(
  stagehandBrowserSessionsTable,
  {
    id: z.uuid().optional(),
    projectId: z.uuid(),
    browserbaseSessionId: z.uuid().nullable().optional(),
    defaultLLMSessionId: z.uuid(),
  },
).strict();

export const stagehandBrowserSessionUpdateSchema = createUpdateSchema(
  stagehandBrowserSessionsTable,
  {
    id: z.uuid().optional(),
    projectId: z.uuid().optional(),
    browserbaseSessionId: z.uuid().nullable().optional(),
    defaultLLMSessionId: z.uuid().optional(),
  },
).strict();

export const stagehandStepSelectSchema = createSelectSchema(
  stagehandStepsTable,
  {
    id: z.uuid(),
    stagehandBrowserSessionId: z.uuid(),
    llmTemplateId: z.uuid(),
    llmSessionId: z.uuid().nullable(),
    params: DatabaseJsonValueSchema,
    result: DatabaseJsonValueSchema.nullable(),
  },
).strict();

export const stagehandStepInsertSchema = createInsertSchema(
  stagehandStepsTable,
  {
    id: z.uuid().optional(),
    stagehandBrowserSessionId: z.uuid(),
    llmTemplateId: z.uuid(),
    llmSessionId: z.uuid().nullable().optional(),
    params: DatabaseJsonValueSchema,
    result: DatabaseJsonValueSchema.nullable().optional(),
  },
).strict();

export const stagehandStepUpdateSchema = createUpdateSchema(
  stagehandStepsTable,
  {
    id: z.uuid().optional(),
    stagehandBrowserSessionId: z.uuid().optional(),
    llmTemplateId: z.uuid().optional(),
    llmSessionId: z.uuid().nullable().optional(),
    params: DatabaseJsonValueSchema.optional(),
    result: DatabaseJsonValueSchema.nullable().optional(),
  },
).strict();

export type LLMConfigSelect = z.infer<typeof llmConfigSelectSchema>;
export type LLMConfigInsert = z.infer<typeof llmConfigInsertSchema>;
export type LLMConfigUpdate = z.infer<typeof llmConfigUpdateSchema>;
export type LLMSessionSelect = z.infer<typeof llmSessionSelectSchema>;
export type LLMCallSelect = z.infer<typeof llmCallSelectSchema>;
export type StagehandBrowserSessionSelect = z.infer<
  typeof stagehandBrowserSessionSelectSchema
>;
export type StagehandStepSelect = z.infer<typeof stagehandStepSelectSchema>;
