/**
 * Centralized Zod schemas for Stagehand Server API
 *
 * These schemas define the complete API contract. Using `.meta({ id: 'Name' })`
 * registers them as reusable OpenAPI components, generating proper $ref references.
 */
import { z } from "zod/v4";

// Re-define localBrowserLaunchOptionsSchema using zod/v4 to ensure type compatibility
// with fastify-zod-openapi (which requires zod v4 schemas)
const localBrowserLaunchOptionsSchemaV4 = z
  .object({
    args: z.array(z.string()).optional(),
    executablePath: z.string().optional(),
    userDataDir: z.string().optional(),
    preserveUserDataDir: z.boolean().optional(),
    headless: z.boolean().optional(),
    devtools: z.boolean().optional(),
    chromiumSandbox: z.boolean().optional(),
    ignoreDefaultArgs: z.union([z.boolean(), z.array(z.string())]).optional(),
    proxy: z
      .object({
        server: z.string(),
        bypass: z.string().optional(),
        username: z.string().optional(),
        password: z.string().optional(),
      })
      .optional(),
    locale: z.string().optional(),
    viewport: z.object({ width: z.number(), height: z.number() }).optional(),
    deviceScaleFactor: z.number().optional(),
    hasTouch: z.boolean().optional(),
    ignoreHTTPSErrors: z.boolean().optional(),
    cdpUrl: z.string().optional(),
    connectTimeoutMs: z.number().optional(),
    downloadsPath: z.string().optional(),
    acceptDownloads: z.boolean().optional(),
  })
  .strict()
  .meta({ id: "LocalBrowserLaunchOptions" });

// =============================================================================
// Common Schemas (reusable components)
// =============================================================================

/** Model configuration - string model name or detailed config */
export const ModelConfigSchema = z
  .string()
  .or(
    z.object({
      modelName: z.string(),
      apiKey: z.string().optional(),
      baseURL: z.string().url().optional(),
    }),
  )
  .meta({ id: "ModelConfig" });

/** Common options shared across act/extract/observe */
export const CommonOptionsSchema = z
  .object({
    model: ModelConfigSchema.optional(),
    timeout: z.number().optional(),
  })
  .meta({ id: "CommonOptions" });

/** Action input - either a string instruction or an action object */
export const ActionInputSchema = z
  .object({
    selector: z.string(),
    description: z.string(),
    method: z.string().optional(),
    arguments: z.array(z.string()).optional(),
  })
  .meta({ id: "ActionInput" });

/** Session ID path parameter */
export const SessionIdParamsSchema = z
  .object({
    id: z.string(),
  })
  .strict()
  .meta({ id: "SessionIdParams" });

/** Browser configuration for session start */
export const BrowserConfigSchema = z
  .object({
    type: z.enum(["local", "browserbase"]).optional(),
    cdpUrl: z.string().optional(),
    launchOptions: localBrowserLaunchOptionsSchemaV4.optional(),
  })
  .meta({ id: "BrowserConfig" });

/** Standard success response wrapper */
export const SuccessResponseSchema = <T extends z.ZodTypeAny>(
  dataSchema: T,
  name: string,
) =>
  z
    .object({
      success: z.literal(true),
      data: dataSchema,
    })
    .strict()
    .meta({ id: name });

/** Standard error response */
export const ErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.string(),
    code: z.string().optional(),
  })
  .strict()
  .meta({ id: "ErrorResponse" });

// =============================================================================
// Session Start
// =============================================================================

export const SessionStartRequestSchema = z
  .object({
    modelName: z.string().meta({
      description: "Model name to use for AI operations",
      example: "gpt-4o",
    }),
    domSettleTimeoutMs: z.number().optional(),
    verbose: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    debugDom: z.boolean().optional(),
    systemPrompt: z.string().optional(),
    browserbaseSessionCreateParams: z.record(z.string(), z.unknown()).optional(),
    browser: BrowserConfigSchema.optional(),
    selfHeal: z.boolean().optional(),
    waitForCaptchaSolves: z.boolean().optional(),
    actTimeoutMs: z.number().optional(),
    browserbaseSessionID: z.string().optional(),
    experimental: z.boolean().optional(),
  })
  .strict()
  .meta({ id: "SessionStartRequest" });

export const SessionStartResponseDataSchema = z
  .object({
    sessionId: z.string().meta({
      description: "Unique session identifier",
      example: "c4dbf3a9-9a58-4b22-8a1c-9f20f9f9e123",
    }),
    available: z.boolean(),
    cdpUrl: z.string().meta({
      description: "Chrome DevTools Protocol URL",
      example: "ws://localhost:9222",
    }),
  })
  .strict()
  .meta({ id: "SessionStartResponseData" });

export const SessionStartResponseSchema = SuccessResponseSchema(
  SessionStartResponseDataSchema,
  "SessionStartResponse",
);

// =============================================================================
// Session End
// =============================================================================

export const SessionEndResponseDataSchema = z
  .object({})
  .strict()
  .meta({ id: "SessionEndResponseData" });

export const SessionEndResponseSchema = SuccessResponseSchema(
  SessionEndResponseDataSchema,
  "SessionEndResponse",
);

// =============================================================================
// Act
// =============================================================================

export const ActOptionsSchema = z
  .object({
    model: ModelConfigSchema.optional(),
    variables: z.record(z.string(), z.string()).optional(),
    timeout: z.number().optional(),
  })
  .optional()
  .meta({ id: "ActOptions" });

export const ActRequestSchema = z
  .object({
    input: z.string().or(ActionInputSchema),
    options: ActOptionsSchema,
    frameId: z.string().optional(),
  })
  .meta({ id: "ActRequest" });

export const ActResultSchema = z
  .object({
    result: z.unknown(),
  })
  .strict()
  .meta({ id: "ActResult" });

export const ActResponseSchema = SuccessResponseSchema(
  ActResultSchema,
  "ActResponse",
);

// =============================================================================
// Extract
// =============================================================================

export const ExtractOptionsSchema = z
  .object({
    model: ModelConfigSchema.optional(),
    timeout: z.number().optional(),
    selector: z.string().optional(),
  })
  .optional()
  .meta({ id: "ExtractOptions" });

export const ExtractRequestSchema = z
  .object({
    instruction: z.string().optional(),
    schema: z.record(z.string(), z.unknown()).optional(),
    options: ExtractOptionsSchema,
    frameId: z.string().optional(),
  })
  .meta({ id: "ExtractRequest" });

export const ExtractResultSchema = z
  .object({
    result: z.unknown(),
  })
  .strict()
  .meta({ id: "ExtractResult" });

export const ExtractResponseSchema = SuccessResponseSchema(
  ExtractResultSchema,
  "ExtractResponse",
);

// =============================================================================
// Observe
// =============================================================================

export const ObserveOptionsSchema = z
  .object({
    model: ModelConfigSchema.optional(),
    timeout: z.number().optional(),
    selector: z.string().optional(),
  })
  .optional()
  .meta({ id: "ObserveOptions" });

export const ObserveRequestSchema = z
  .object({
    instruction: z.string().optional(),
    options: ObserveOptionsSchema,
    frameId: z.string().optional(),
  })
  .meta({ id: "ObserveRequest" });

export const ObserveResultSchema = z
  .object({
    result: z.unknown(),
  })
  .strict()
  .meta({ id: "ObserveResult" });

export const ObserveResponseSchema = SuccessResponseSchema(
  ObserveResultSchema,
  "ObserveResponse",
);

// =============================================================================
// Agent Execute
// =============================================================================

export const AgentConfigSchema = z
  .object({
    model: ModelConfigSchema.optional(),
    systemPrompt: z.string().optional(),
    cua: z.boolean().optional(),
  })
  .meta({ id: "AgentConfig" });

export const ExecuteOptionsSchema = z
  .object({
    instruction: z.string(),
    maxSteps: z.number().optional(),
    highlightCursor: z.boolean().optional(),
  })
  .meta({ id: "ExecuteOptions" });

export const AgentExecuteRequestSchema = z
  .object({
    agentConfig: AgentConfigSchema,
    executeOptions: ExecuteOptionsSchema,
    frameId: z.string().optional(),
  })
  .meta({ id: "AgentExecuteRequest" });

export const AgentExecuteResultSchema = z
  .object({
    result: z.unknown(),
  })
  .strict()
  .meta({ id: "AgentExecuteResult" });

export const AgentExecuteResponseSchema = SuccessResponseSchema(
  AgentExecuteResultSchema,
  "AgentExecuteResponse",
);

// =============================================================================
// Navigate
// =============================================================================

export const NavigateOptionsSchema = z
  .object({
    referer: z.string().optional(),
    timeout: z.number().optional(),
    waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
  })
  .optional()
  .meta({ id: "NavigateOptions" });

export const NavigateRequestSchema = z
  .object({
    url: z.string(),
    options: NavigateOptionsSchema,
    frameId: z.string().optional(),
  })
  .meta({ id: "NavigateRequest" });

/** Navigate response from Playwright */
export const NavigateResponseDataSchema = z
  .object({
    requestId: z.string(),
    frameId: z.string().optional(),
    loaderId: z.string().optional(),
    response: z.unknown(),
    fromServiceWorkerFlag: z.boolean().optional(),
    finishedSettled: z.boolean().optional(),
    extraInfoHeaders: z.record(z.string(), z.string()).nullish(),
    extraInfoHeadersText: z.string().optional(),
  })
  .meta({ id: "NavigateResponseData" });

export const NavigateResultSchema = z
  .object({
    result: NavigateResponseDataSchema.nullable(),
  })
  .strict()
  .meta({ id: "NavigateResult" });

export const NavigateResponseSchema = SuccessResponseSchema(
  NavigateResultSchema,
  "NavigateResponse",
);

// =============================================================================
// Type exports
// =============================================================================

export type SessionStartRequest = z.infer<typeof SessionStartRequestSchema>;
export type ActRequest = z.infer<typeof ActRequestSchema>;
export type ExtractRequest = z.infer<typeof ExtractRequestSchema>;
export type ObserveRequest = z.infer<typeof ObserveRequestSchema>;
export type AgentExecuteRequest = z.infer<typeof AgentExecuteRequestSchema>;
export type NavigateRequest = z.infer<typeof NavigateRequestSchema>;

/**
 * Result returned when starting a new session
 */
export interface SessionStartResult {
  sessionId: string;
  available: boolean;
}
