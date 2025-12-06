import { z } from "zod";

/**
 * Shared Zod schemas for Stagehand Server API
 * These schemas define the complete API contract between SDK clients and the server.
 * Used for runtime validation, type inference, and OpenAPI generation.
 *
 * Naming convention:
 * - Schemas: TitleCase with Schema suffix (e.g., ActRequestSchema, ActResponseSchema)
 * - Types: TitleCase matching schema name without Schema suffix (e.g., ActRequest, ActResponse)
 */

// =============================================================================
// Common Schemas
// =============================================================================

/** Standard API success response wrapper */
export const SuccessResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  });

/** Model configuration for LLM calls (used in action options) */
export const ModelConfigSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  baseURL: z.string().url().optional(),
});

/** Headers expected on API requests */
export const RequestHeadersSchema = z.object({
  "x-bb-api-key": z.string().optional(),
  "x-bb-project-id": z.string().optional(),
  "x-model-api-key": z.string().optional(),
  "x-sdk-version": z.string().optional(),
  "x-language": z.enum(["typescript", "python", "playground"]).optional(),
  "x-stream-response": z.string().optional(),
  "x-sent-at": z.string().optional(),
});

/** Route params for /sessions/:id/* routes */
export const SessionIdParamsSchema = z.object({
  id: z.string(),
});

/** Action schema - represents a single observable action */
export const ActionSchema = z.object({
  selector: z.string(),
  description: z.string(),
  backendNodeId: z.number().optional(),
  method: z.string().optional(),
  arguments: z.array(z.string()).optional(),
});

// =============================================================================
// Session Start
// =============================================================================

/** POST /v1/sessions/start - Request body */
export const SessionStartRequestSchema = z.object({
  modelName: z.string(),
  domSettleTimeoutMs: z.number().optional(),
  verbose: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  systemPrompt: z.string().optional(),
  selfHeal: z.boolean().optional(),
  browserbaseSessionID: z.string().optional(),
  sessionId: z.string().optional(), // Alias for browserbaseSessionID
  browserbaseSessionCreateParams: z.record(z.string(), z.unknown()).optional(),
  waitForCaptchaSolves: z.boolean().optional(),
  experimental: z.boolean().optional(),
  debugDom: z.boolean().optional(),
  actTimeoutMs: z.number().optional(),
});

/** Internal result from SessionStore.startSession() - sessionId always present */
export const SessionStartResultSchema = z.object({
  sessionId: z.string(),
  available: z.boolean(),
});

/** POST /v1/sessions/start - HTTP response data (sessionId can be null when unavailable) */
export const SessionStartResponseDataSchema = z.object({
  sessionId: z.string().nullable(),
  available: z.boolean(),
});

/** POST /v1/sessions/start - Full HTTP response */
export const SessionStartResponseSchema = SuccessResponseSchema(SessionStartResponseDataSchema);

// =============================================================================
// Session End
// =============================================================================

/** POST /v1/sessions/:id/end - Request body (empty, session ID comes from params) */
export const SessionEndRequestSchema = z.object({}).nullish();

/** POST /v1/sessions/:id/end - Response */
export const SessionEndResponseSchema = z.object({
  success: z.literal(true),
});

// =============================================================================
// Act
// =============================================================================

/** POST /v1/sessions/:id/act - Request body */
export const ActRequestSchema = z.object({
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
      model: ModelConfigSchema.optional(),
      variables: z.record(z.string(), z.string()).optional(),
      timeout: z.number().optional(),
    })
    .optional(),
  frameId: z.string().optional(),
});

/** POST /v1/sessions/:id/act - Response (matches ActResult) */
export const ActResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  actionDescription: z.string(),
  actions: z.array(ActionSchema),
});

// =============================================================================
// Extract
// =============================================================================

/** POST /v1/sessions/:id/extract - Request body */
export const ExtractRequestSchema = z.object({
  instruction: z.string().optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
  options: z
    .object({
      model: ModelConfigSchema.optional(),
      timeout: z.number().optional(),
      selector: z.string().optional(),
    })
    .optional(),
  frameId: z.string().optional(),
});

/** POST /v1/sessions/:id/extract - Response (dynamic based on user's schema) */
export const ExtractResponseSchema = z.record(z.string(), z.unknown());

// =============================================================================
// Observe
// =============================================================================

/** POST /v1/sessions/:id/observe - Request body */
export const ObserveRequestSchema = z.object({
  instruction: z.string().optional(),
  options: z
    .object({
      model: ModelConfigSchema.optional(),
      timeout: z.number().optional(),
      selector: z.string().optional(),
    })
    .optional(),
  frameId: z.string().optional(),
});

/** POST /v1/sessions/:id/observe - Response (array of actions) */
export const ObserveResponseSchema = z.array(ActionSchema);

// =============================================================================
// Agent Execute
// =============================================================================

/** POST /v1/sessions/:id/agentExecute - Request body */
export const AgentExecuteRequestSchema = z.object({
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

/** POST /v1/sessions/:id/agentExecute - Response (matches AgentResult) */
export const AgentExecuteResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  actions: z.array(z.unknown()),
  completed: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  usage: z
    .object({
      input_tokens: z.number(),
      output_tokens: z.number(),
      reasoning_tokens: z.number().optional(),
      cached_input_tokens: z.number().optional(),
      inference_time_ms: z.number(),
    })
    .optional(),
});

// =============================================================================
// Navigate
// =============================================================================

/** POST /v1/sessions/:id/navigate - Request body */
export const NavigateRequestSchema = z.object({
  url: z.string(),
  options: z
    .object({
      waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
    })
    .optional(),
  frameId: z.string().optional(),
});

/** POST /v1/sessions/:id/navigate - Response */
export const NavigateResponseSchema = z
  .object({
    url: z.string(),
    status: z.number(),
  })
  .nullable();

// =============================================================================
// Inferred Types
// =============================================================================

// Common types
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type RequestHeaders = z.infer<typeof RequestHeadersSchema>;
export type SessionIdParams = z.infer<typeof SessionIdParamsSchema>;
export type Action = z.infer<typeof ActionSchema>;

// Session types
export type SessionStartRequest = z.infer<typeof SessionStartRequestSchema>;
export type SessionStartResult = z.infer<typeof SessionStartResultSchema>;
export type SessionStartResponseData = z.infer<typeof SessionStartResponseDataSchema>;
export type SessionEndRequest = z.infer<typeof SessionEndRequestSchema>;
export type SessionEndResponse = z.infer<typeof SessionEndResponseSchema>;

// Act types
export type ActRequest = z.infer<typeof ActRequestSchema>;
export type ActResponse = z.infer<typeof ActResponseSchema>;

// Extract types
export type ExtractRequest = z.infer<typeof ExtractRequestSchema>;
export type ExtractResponse = z.infer<typeof ExtractResponseSchema>;

// Observe types
export type ObserveRequest = z.infer<typeof ObserveRequestSchema>;
export type ObserveResponse = z.infer<typeof ObserveResponseSchema>;

// Agent Execute types
export type AgentExecuteRequest = z.infer<typeof AgentExecuteRequestSchema>;
export type AgentExecuteResponse = z.infer<typeof AgentExecuteResponseSchema>;

// Navigate types
export type NavigateRequest = z.infer<typeof NavigateRequestSchema>;
export type NavigateResponse = z.infer<typeof NavigateResponseSchema>;
