import { z } from "zod";

/**
 * Shared Zod schemas for Stagehand Server API
 * These schemas define the complete API contract between SDK clients and the server.
 * Used for runtime validation, type inference, and OpenAPI generation.
 */

// =============================================================================
// Common Schemas
// =============================================================================

/** Standard API success response wrapper */
export const successResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  });

/** Standard API error response */
export const errorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string(),
});

/** Model configuration for LLM calls */
export const modelConfigSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  baseURL: z.string().url().optional(),
});

// =============================================================================
// Request Headers Schema
// =============================================================================

/** Headers expected on API requests */
export const requestHeadersSchema = z.object({
  "x-bb-api-key": z.string().optional(),
  "x-bb-project-id": z.string().optional(),
  "x-model-api-key": z.string().optional(),
  "x-sdk-version": z.string().optional(),
  "x-language": z.enum(["typescript", "python", "playground"]).optional(),
  "x-stream-response": z.string().optional(),
  "x-sent-at": z.string().optional(),
});

// =============================================================================
// Session Schemas
// =============================================================================

/** POST /v1/sessions/start - Request body */
export const startSessionRequestSchema = z.object({
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

/** POST /v1/sessions/start - Response data */
export const startSessionResponseDataSchema = z.object({
  sessionId: z.string().nullable(),
  available: z.boolean(),
});

/** POST /v1/sessions/start - Full response */
export const startSessionResponseSchema = successResponseSchema(startSessionResponseDataSchema);

/** POST /v1/sessions/:id/end - Response */
export const endSessionResponseSchema = z.object({
  success: z.literal(true),
});

// =============================================================================
// Action Request Schemas (V3 API)
// =============================================================================

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

// =============================================================================
// Action Response Schemas
// =============================================================================

/** Action schema - represents a single observable action */
export const actionSchema = z.object({
  selector: z.string(),
  description: z.string(),
  backendNodeId: z.number().optional(),
  method: z.string().optional(),
  arguments: z.array(z.string()).optional(),
});

/** Act result schema */
export const actResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  action: z.string().optional(),
});

/** Extract result schema - dynamic based on user's schema */
export const extractResultSchema = z.record(z.string(), z.unknown());

/** Observe result schema - array of actions */
export const observeResultSchema = z.array(actionSchema);

/** Agent result schema */
export const agentResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  actions: z.array(z.unknown()).optional(),
  completed: z.boolean().optional(),
});

/** Navigate result schema */
export const navigateResultSchema = z.object({
  url: z.string().optional(),
  status: z.number().optional(),
});

// =============================================================================
// Route Parameter Schemas
// =============================================================================

/** Route params for /sessions/:id/* routes */
export const sessionIdParamsSchema = z.object({
  id: z.string(),
});

// =============================================================================
// Inferred Types
// =============================================================================

// Request types
export type StartSessionRequest = z.infer<typeof startSessionRequestSchema>;
export type ActRequest = z.infer<typeof actSchemaV3>;
export type ExtractRequest = z.infer<typeof extractSchemaV3>;
export type ObserveRequest = z.infer<typeof observeSchemaV3>;
export type AgentExecuteRequest = z.infer<typeof agentExecuteSchemaV3>;
export type NavigateRequest = z.infer<typeof navigateSchemaV3>;

// Response types
export type StartSessionResponseData = z.infer<typeof startSessionResponseDataSchema>;
export type ActResult = z.infer<typeof actResultSchema>;
export type ExtractResult = z.infer<typeof extractResultSchema>;
export type ObserveResult = z.infer<typeof observeResultSchema>;
export type AgentResult = z.infer<typeof agentResultSchema>;
export type NavigateResult = z.infer<typeof navigateResultSchema>;
export type Action = z.infer<typeof actionSchema>;

// Header types
export type RequestHeaders = z.infer<typeof requestHeadersSchema>;

// Route param types
export type SessionIdParams = z.infer<typeof sessionIdParamsSchema>;
