/**
 * Centralized Zod schemas for Stagehand Server API
 *
 * Naming conventions:
 * - `*RequestSchema` - Request body schemas (zod4), `*Request` is the inferred type
 * - `*ResultSchema` - Inner response data (unwrapped), `*Result` is the inferred type
 * - `*ResponseSchema` - Full response with success wrapper: { success: true, data: *Result }, `*Response` is the inferred type
 *
 * All TypeScript types are inferred from the Zod4 *Schemas using z.infer<>
 */
import { z } from "zod/v4";
import type Browserbase from "@browserbasehq/sdk";

// =============================================================================
// Shared Components
// =============================================================================

/** Browser launch options for local browsers */
export const LocalBrowserLaunchOptionsSchema = z
  .object({
    args: z.array(z.string()).optional(),
    executablePath: z.string().optional(),
    port: z.number().optional(),
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

/** Detailed model configuration object */
export const ModelConfigObjectSchema = z
  .object({
    provider: z
      .enum(["openai", "anthropic", "google", "microsoft"])
      .optional()
      .meta({
        description:
          "AI provider for the model (or provide a baseURL endpoint instead)",
        example: "openai",
      }),
    modelName: z.string().meta({
      description:
        "Model name string with provider prefix (e.g., 'openai/gpt-5-nano')",
      example: "openai/gpt-5-nano",
    }),
    apiKey: z.string().optional().meta({
      description: "API key for the model provider",
      example: "sk-some-openai-api-key",
    }),
    baseURL: z.string().url().optional().meta({
      description: "Base URL for the model provider",
      example: "https://api.openai.com/v1",
    }),
  })
  .meta({ id: "ModelConfigObject" });

/** Model configuration */
export const ModelConfigSchema = ModelConfigObjectSchema.meta({
  id: "ModelConfig",
});

/** Action object returned by observe and used by act */
export const ActionSchema = z
  .object({
    selector: z.string().meta({
      description: "CSS selector or XPath for the element",
      example: "[data-testid='submit-button']",
    }),
    description: z.string().meta({
      description: "Human-readable description of the action",
      example: "Click the submit button",
    }),
    backendNodeId: z.number().optional().meta({
      description: "Backend node ID for the element",
    }),
    method: z.string().optional().meta({
      description: "The method to execute (click, fill, etc.)",
      example: "click",
    }),
    arguments: z
      .array(z.string())
      .optional()
      .meta({
        description: "Arguments to pass to the method",
        example: ["Hello World"],
      }),
  })
  .meta({
    id: "Action",
    description: "Action object returned by observe and used by act",
  });

/** Session ID path parameter */
export const SessionIdParamsSchema = z
  .object({
    id: z.string().meta({
      description: "Unique session identifier",
      example: "c4dbf3a9-9a58-4b22-8a1c-9f20f9f9e123",
    }),
  })
  .strict()
  .meta({ id: "SessionIdParams" });

/** Browser configuration for session start */
export const BrowserConfigSchema = z
  .object({
    type: z.enum(["local", "browserbase"]).optional().meta({
      description: "Browser type to use",
      example: "local",
    }),
    cdpUrl: z.string().optional().meta({
      description:
        "Chrome DevTools Protocol URL for connecting to existing browser",
      example: "ws://localhost:9222",
    }),
    launchOptions: LocalBrowserLaunchOptionsSchema.optional(),
  })
  .meta({ id: "BrowserConfig" });

// =============================================================================
// Request Headers (operational only - auth headers are in security schemes)
// =============================================================================

/** Operational headers for all session requests (auth handled via security schemes) */
export const SessionHeadersSchema = z
  .object({
    "x-stream-response": z.enum(["true", "false"]).optional().meta({
      description: "Whether to stream the response via SSE",
      example: "true",
    }),
  })
  .meta({ id: "SessionHeaders" });

// =============================================================================
// Response Wrapper Helper
// =============================================================================

/** Wraps a result schema in standard success response format */
const wrapResponse = <T extends z.ZodTypeAny>(resultSchema: T, name: string) =>
  z
    .object({
      success: z.boolean().meta({
        description: "Indicates whether the request was successful",
      }),
      data: resultSchema,
    })
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
// Browserbase Session Create Params  (zod+hints duplicated version of Browserbase.Sessions.SessionCreateParams)
// =============================================================================

/** Browserbase viewport configuration */
export const BrowserbaseViewportSchema = z
  .object({
    width: z.number().optional(),
    height: z.number().optional(),
  })
  .meta({ id: "BrowserbaseViewport" });

/** Browserbase fingerprint screen configuration */
export const BrowserbaseFingerprintScreenSchema = z
  .object({
    maxHeight: z.number().optional(),
    maxWidth: z.number().optional(),
    minHeight: z.number().optional(),
    minWidth: z.number().optional(),
  })
  .meta({ id: "BrowserbaseFingerprintScreen" });

/** Browserbase fingerprint configuration for stealth mode */
export const BrowserbaseFingerprintSchema = z
  .object({
    browsers: z
      .array(z.enum(["chrome", "edge", "firefox", "safari"]))
      .optional(),
    devices: z.array(z.enum(["desktop", "mobile"])).optional(),
    httpVersion: z.enum(["1", "2"]).optional(),
    locales: z.array(z.string()).optional(),
    operatingSystems: z
      .array(z.enum(["android", "ios", "linux", "macos", "windows"]))
      .optional(),
    screen: BrowserbaseFingerprintScreenSchema.optional(),
  })
  .meta({ id: "BrowserbaseFingerprint" });

/** Browserbase context configuration for session persistence */
export const BrowserbaseContextSchema = z
  .object({
    id: z.string(),
    persist: z.boolean().optional(),
  })
  .meta({ id: "BrowserbaseContext" });

/** Browserbase browser settings for session creation */
export const BrowserbaseBrowserSettingsSchema = z
  .object({
    advancedStealth: z.boolean().optional(),
    blockAds: z.boolean().optional(),
    context: BrowserbaseContextSchema.optional(),
    extensionId: z.string().optional(),
    fingerprint: BrowserbaseFingerprintSchema.optional(),
    logSession: z.boolean().optional(),
    recordSession: z.boolean().optional(),
    solveCaptchas: z.boolean().optional(),
    viewport: BrowserbaseViewportSchema.optional(),
  })
  .meta({ id: "BrowserbaseBrowserSettings" });

/** Browserbase managed proxy geolocation configuration */
export const BrowserbaseProxyGeolocationSchema = z
  .object({
    country: z.string(),
    city: z.string().optional(),
    state: z.string().optional(),
  })
  .meta({ id: "BrowserbaseProxyGeolocation" });

/** Browserbase managed proxy configuration */
export const BrowserbaseProxyConfigSchema = z
  .object({
    type: z.literal("browserbase"),
    domainPattern: z.string().optional(),
    geolocation: BrowserbaseProxyGeolocationSchema.optional(),
  })
  .meta({ id: "BrowserbaseProxyConfig" });

/** External proxy configuration */
export const ExternalProxyConfigSchema = z
  .object({
    type: z.literal("external"),
    server: z.string(),
    domainPattern: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
  })
  .meta({ id: "ExternalProxyConfig" });

/** Union of proxy configuration types */
export const ProxyConfigSchema = z
  .discriminatedUnion("type", [
    BrowserbaseProxyConfigSchema,
    ExternalProxyConfigSchema,
  ])
  .meta({ id: "ProxyConfig" });

/** Browserbase region identifier for multi-region support */
export const BrowserbaseRegionSchema = z
  .enum(["us-west-2", "us-east-1", "eu-central-1", "ap-southeast-1"])
  .meta({ id: "BrowserbaseRegion" });

/** Browserbase session creation parameters */
export const BrowserbaseSessionCreateParamsSchema = z
  .object({
    projectId: z.string().optional(),
    browserSettings: BrowserbaseBrowserSettingsSchema.optional(),
    extensionId: z.string().optional(),
    keepAlive: z.boolean().optional(),
    proxies: z.union([z.boolean(), z.array(ProxyConfigSchema)]).optional(),
    region: BrowserbaseRegionSchema.optional(),
    timeout: z.number().optional(),
    userMetadata: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: "BrowserbaseSessionCreateParams" });

// =============================================================================
// Session Start
// =============================================================================

export const SessionStartRequestSchema = z
  .object({
    modelName: z.string().meta({
      description: "Model name to use for AI operations",
      example: "openai/gpt-4o",
    }),
    domSettleTimeoutMs: z.number().optional().meta({
      description: "Timeout in ms to wait for DOM to settle",
      example: 5000,
    }),
    verbose: z
      .union([z.literal(0), z.literal(1), z.literal(2)])
      .optional()
      .meta({
        description: "Logging verbosity level (0=quiet, 1=normal, 2=debug)",
        example: 1,
        override: ({ jsonSchema }: { jsonSchema: Record<string, unknown> }) => {
          delete jsonSchema.anyOf;
          delete jsonSchema.allOf;
          delete jsonSchema.oneOf;
          jsonSchema.type = "number";
          jsonSchema.enum = [0, 1, 2];
        },
      }),
    systemPrompt: z.string().optional().meta({
      description: "Custom system prompt for AI operations",
    }),
    browserbaseSessionCreateParams:
      BrowserbaseSessionCreateParamsSchema.optional(),
    browser: BrowserConfigSchema.optional(),
    selfHeal: z.boolean().optional().meta({
      description: "Enable self-healing for failed actions",
      example: true,
    }),
    browserbaseSessionID: z.string().optional().meta({
      description: "Existing Browserbase session ID to resume",
    }),
    // experimental is a V3 field but doesn't need to go over the wire - included because wire type imports options type
    experimental: z.boolean().optional(),
    // V2 compatibility fields - only included because the server imports this type and supports V2
    // should never be used in v3 clients or v3-only server implementations
    waitForCaptchaSolves: z.boolean().optional().meta({
      description: "Wait for captcha solves (deprecated, v2 only)",
    }),
    actTimeoutMs: z.number().optional().meta({
      description: "Timeout in ms for act operations (deprecated, v2 only)",
    }),
  })
  .meta({ id: "SessionStartRequest" });

export const SessionStartResultSchema = z
  .object({
    sessionId: z.string().meta({
      description: "Unique Browserbase session identifier",
      example: "c4dbf3a9-9a58-4b22-8a1c-9f20f9f9e123",
    }),
    cdpUrl: z.string().nullish().meta({
      description:
        "CDP WebSocket URL for connecting to the Browserbase cloud browser (present when available)",
      example: "wss://connect.browserbase.com/?signingKey=abc123",
    }),
    available: z.boolean(),
  })
  .meta({ id: "SessionStartResult" });

export const SessionStartResponseSchema = wrapResponse(
  SessionStartResultSchema,
  "SessionStartResponse",
);

// =============================================================================
// Session End
// =============================================================================

/** Session end request - no request body. */
export const SessionEndRequestSchema = z
  .object({})
  .strict()
  .optional()
  .meta({ id: "SessionEndRequest" });

export const SessionEndResultSchema = z
  .object({})
  .strict()
  .meta({ id: "SessionEndResult" });

/** Session end response - just success flag, no data wrapper */
export const SessionEndResponseSchema = z
  .object({
    success: z.boolean().meta({
      description: "Indicates whether the request was successful",
    }),
  })
  .strict()
  .meta({ id: "SessionEndResponse" });

// =============================================================================
// Act
// =============================================================================

export const ActOptionsSchema = z
  .object({
    model: z.union([ModelConfigSchema, z.string()]).optional().meta({
      description:
        "Model configuration object or model name string (e.g., 'openai/gpt-5-nano')",
    }),
    variables: z
      .record(z.string(), z.string())
      .optional()
      .meta({
        description: "Variables to substitute in the action instruction",
        example: { username: "john_doe" },
      }),
    timeout: z.number().optional().meta({
      description: "Timeout in ms for the action",
      example: 30000,
    }),
  })
  .optional()
  .meta({ id: "ActOptions" });

export const ActRequestSchema = z
  .object({
    input: z.string().or(ActionSchema).meta({
      description: "Natural language instruction or Action object",
      example: "Click the login button",
    }),
    options: ActOptionsSchema,
    frameId: z.string().nullish().meta({
      description: "Target frame ID for the action",
    }),
    streamResponse: z.boolean().optional().meta({
      description: "Whether to stream the response via SSE",
      example: true,
    }),
  })
  .meta({ id: "ActRequest" });

/** Inner act result data */
export const ActResultDataSchema = z
  .object({
    success: z.boolean().meta({
      description: "Whether the action completed successfully",
      example: true,
    }),
    message: z.string().meta({
      description: "Human-readable result message",
      example: "Successfully clicked the login button",
    }),
    actionDescription: z.string().meta({
      description: "Description of the action that was performed",
      example: "Clicked button with text 'Login'",
    }),
    actions: z.array(ActionSchema).meta({
      description: "List of actions that were executed",
    }),
  })
  .meta({ id: "ActResultData" });

export const ActResultSchema = z
  .object({
    result: ActResultDataSchema,
    actionId: z.string().optional().meta({
      description: "Action ID for tracking",
    }),
  })
  .meta({ id: "ActResult" });

export const ActResponseSchema = wrapResponse(ActResultSchema, "ActResponse");

// =============================================================================
// Extract
// =============================================================================

export const ExtractOptionsSchema = z
  .object({
    model: z.union([ModelConfigSchema, z.string()]).optional().meta({
      description:
        "Model configuration object or model name string (e.g., 'openai/gpt-5-nano')",
    }),
    timeout: z.number().optional().meta({
      description: "Timeout in ms for the extraction",
      example: 30000,
    }),
    selector: z.string().optional().meta({
      description: "CSS selector to scope extraction to a specific element",
      example: "#main-content",
    }),
  })
  .optional()
  .meta({ id: "ExtractOptions" });

export const ExtractRequestSchema = z
  .object({
    instruction: z.string().optional().meta({
      description: "Natural language instruction for what to extract",
      example: "Extract all product names and prices from the page",
    }),
    schema: z.record(z.string(), z.unknown()).optional().meta({
      description: "JSON Schema defining the structure of data to extract",
    }),
    options: ExtractOptionsSchema,
    frameId: z.string().nullish().meta({
      description: "Target frame ID for the extraction",
    }),
    streamResponse: z.boolean().optional().meta({
      description: "Whether to stream the response via SSE",
      example: true,
    }),
  })
  .meta({ id: "ExtractRequest" });

export const ExtractResultSchema = z
  .object({
    result: z.unknown().meta({
      description: "Extracted data matching the requested schema",
      override: ({ jsonSchema }: { jsonSchema: Record<string, unknown> }) => {
        jsonSchema["x-stainless-any"] = true;
      },
    }),
    actionId: z.string().optional().meta({
      description: "Action ID for tracking",
    }),
  })
  .meta({ id: "ExtractResult" });

export const ExtractResponseSchema = wrapResponse(
  ExtractResultSchema,
  "ExtractResponse",
);

// =============================================================================
// Observe
// =============================================================================

export const ObserveOptionsSchema = z
  .object({
    model: z.union([ModelConfigSchema, z.string()]).optional().meta({
      description:
        "Model configuration object or model name string (e.g., 'openai/gpt-5-nano')",
    }),
    timeout: z.number().optional().meta({
      description: "Timeout in ms for the observation",
      example: 30000,
    }),
    selector: z.string().optional().meta({
      description: "CSS selector to scope observation to a specific element",
      example: "nav",
    }),
  })
  .optional()
  .meta({ id: "ObserveOptions" });

export const ObserveRequestSchema = z
  .object({
    instruction: z.string().optional().meta({
      description: "Natural language instruction for what actions to find",
      example: "Find all clickable navigation links",
    }),
    options: ObserveOptionsSchema,
    frameId: z.string().nullish().meta({
      description: "Target frame ID for the observation",
    }),
    streamResponse: z.boolean().optional().meta({
      description: "Whether to stream the response via SSE",
      example: true,
    }),
  })
  .meta({ id: "ObserveRequest" });

export const ObserveResultSchema = z
  .object({
    result: z.array(ActionSchema),
    actionId: z.string().optional().meta({
      description: "Action ID for tracking",
    }),
  })
  .meta({ id: "ObserveResult" });

export const ObserveResponseSchema = wrapResponse(
  ObserveResultSchema,
  "ObserveResponse",
);

// =============================================================================
// Agent Execute
// =============================================================================

export const AgentConfigSchema = z
  .object({
    provider: z // cloud accepts provider: at the top level for legacy reasons, in the future we should remove it
      .enum(["openai", "anthropic", "google", "microsoft"])
      .optional()
      .meta({
        description:
          "AI provider for the agent (legacy, use model: openai/gpt-5-nano instead)",
        example: "openai",
      }),
    model: z.union([ModelConfigSchema, z.string()]).optional().meta({
      description:
        "Model configuration object or model name string (e.g., 'openai/gpt-5-nano')",
    }),
    systemPrompt: z.string().optional().meta({
      description: "Custom system prompt for the agent",
    }),
    cua: z.boolean().optional().meta({
      description:
        "Deprecated. Use mode: 'cua' instead. If both are provided, mode takes precedence.",
      example: true,
    }),
    mode: z.enum(["dom", "hybrid", "cua"]).optional().meta({
      description:
        "Tool mode for the agent (dom, hybrid, cua). If set, overrides cua.",
      example: "cua",
    }),
    executionModel: z.union([ModelConfigSchema, z.string()]).optional().meta({
      description:
        "Model configuration object or model name string (e.g., 'openai/gpt-5-nano') for tool execution (observe/act calls within agent tools). If not specified, inherits from the main model configuration.",
    }),
  })
  .meta({ id: "AgentConfig" });

/** Action taken by the agent during execution */
export const AgentActionSchema = z
  .object({
    type: z.string().meta({
      description: "Type of action taken",
      example: "click",
    }),
    reasoning: z.string().optional().meta({
      description: "Agent's reasoning for taking this action",
    }),
    taskCompleted: z.boolean().optional(),
    action: z.string().optional(),
    timeMs: z.number().optional().meta({
      description: "Time taken for this action in ms",
    }),
    pageText: z.string().optional(),
    pageUrl: z.string().optional(),
    instruction: z.string().optional(),
  })
  .passthrough()
  .meta({ id: "AgentAction" });

/** Token usage statistics for agent execution */
export const AgentUsageSchema = z
  .object({
    input_tokens: z.number().meta({ example: 1500 }),
    output_tokens: z.number().meta({ example: 250 }),
    reasoning_tokens: z.number().optional(),
    cached_input_tokens: z.number().optional(),
    inference_time_ms: z.number().meta({ example: 2500 }),
  })
  .meta({ id: "AgentUsage" });

/** Result data from agent execution */
export const AgentResultDataSchema = z
  .object({
    success: z.boolean().meta({
      description: "Whether the agent completed successfully",
      example: true,
    }),
    message: z.string().meta({
      description: "Summary of what the agent accomplished",
      example: "Successfully logged in and navigated to dashboard",
    }),
    actions: z.array(AgentActionSchema),
    completed: z.boolean().meta({
      description: "Whether the agent finished its task",
      example: true,
    }),
    metadata: z.record(z.string(), z.unknown()).optional(),
    usage: AgentUsageSchema.optional(),
  })
  .meta({ id: "AgentResultData" });

export const AgentCacheEntrySchema = z
  .object({
    cacheKey: z.string().meta({
      description:
        "Opaque cache identifier computed from instruction, URL, options, and config",
    }),
    entry: z.unknown().meta({
      description: "Serialized cache entry that can be written to disk",
    }),
  })
  .meta({ id: "AgentCacheEntry" });

export const AgentExecuteOptionsSchema = z
  .object({
    instruction: z.string().meta({
      description: "Natural language instruction for the agent",
      example:
        "Log in with username 'demo' and password 'test123', then navigate to settings",
    }),
    maxSteps: z.number().optional().meta({
      description: "Maximum number of steps the agent can take",
      example: 20,
    }),
    highlightCursor: z.boolean().optional().meta({
      description: "Whether to visually highlight the cursor during execution",
      example: true,
    }),
  })
  .meta({ id: "AgentExecuteOptions" });

export const AgentExecuteRequestSchema = z
  .object({
    agentConfig: AgentConfigSchema,
    executeOptions: AgentExecuteOptionsSchema,
    frameId: z.string().nullish().meta({
      description: "Target frame ID for the agent",
    }),
    streamResponse: z.boolean().optional().meta({
      description: "Whether to stream the response via SSE",
      example: true,
    }),
    shouldCache: z.boolean().optional().meta({
      description:
        "If true, the server captures a cache entry and returns it to the client",
    }),
  })
  .meta({ id: "AgentExecuteRequest" });

export const AgentExecuteResultSchema = z
  .object({
    result: AgentResultDataSchema,
    cacheEntry: AgentCacheEntrySchema.optional(),
  })
  .meta({ id: "AgentExecuteResult" });

export const AgentExecuteResponseSchema = wrapResponse(
  AgentExecuteResultSchema,
  "AgentExecuteResponse",
);

// =============================================================================
// Navigate
// =============================================================================

export const NavigateOptionsSchema = z
  .object({
    referer: z.string().optional().meta({
      description: "Referer header to send with the request",
    }),
    timeout: z.number().optional().meta({
      description: "Timeout in ms for the navigation",
      example: 30000,
    }),
    waitUntil: z
      .enum(["load", "domcontentloaded", "networkidle"])
      .optional()
      .meta({
        description: "When to consider navigation complete",
        example: "networkidle",
      }),
  })
  .optional()
  .meta({ id: "NavigateOptions" });

export const NavigateRequestSchema = z
  .object({
    url: z.string().meta({
      description: "URL to navigate to",
      example: "https://example.com",
    }),
    options: NavigateOptionsSchema,
    frameId: z.string().nullish().meta({
      description: "Target frame ID for the navigation",
    }),
    streamResponse: z.boolean().optional().meta({
      description: "Whether to stream the response via SSE",
      example: true,
    }),
  })
  .meta({ id: "NavigateRequest" });

export const NavigateResultSchema = z
  .object({
    // SerializableResponse from types/private/api.ts - no Zod schema available
    // as it wraps complex devtools-protocol types (Protocol.Network.Response)
    result: z
      .unknown()
      .nullable()
      .meta({
        description: "Navigation response (Playwright Response object or null)",
        override: ({ jsonSchema }: { jsonSchema: Record<string, unknown> }) => {
          jsonSchema["x-stainless-any"] = true;
        },
      }),
    actionId: z.string().optional().meta({
      description: "Action ID for tracking",
    }),
  })
  .meta({ id: "NavigateResult" });

export const NavigateResponseSchema = wrapResponse(
  NavigateResultSchema,
  "NavigateResponse",
);

// =============================================================================
// Replay Metrics
// =============================================================================

/** Token usage for a single action */
export const TokenUsageSchema = z
  .object({
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    timeMs: z.number().optional(),
    cost: z.number().optional(),
  })
  .meta({ id: "TokenUsage" });

/** Action entry in replay metrics */
export const ReplayActionSchema = z
  .object({
    method: z.string(),
    parameters: z.record(z.string(), z.unknown()),
    result: z.record(z.string(), z.unknown()),
    timestamp: z.number(),
    endTime: z.number().optional(),
    tokenUsage: TokenUsageSchema.optional(),
  })
  .meta({ id: "ReplayAction" });

/** Page entry in replay metrics */
export const ReplayPageSchema = z
  .object({
    url: z.string(),
    timestamp: z.number(),
    duration: z.number(),
    actions: z.array(ReplayActionSchema),
  })
  .meta({ id: "ReplayPage" });

/** Inner result data for replay */
export const ReplayResultSchema = z
  .object({
    pages: z.array(ReplayPageSchema),
    clientLanguage: z.string().optional(),
  })
  .meta({ id: "ReplayResult" });

export const ReplayResponseSchema = wrapResponse(
  ReplayResultSchema,
  "ReplayResponse",
);

// =============================================================================
// SSE Stream Events
// =============================================================================
// These schemas define the Server-Sent Events format for streaming responses.
// Streaming is enabled by setting the `x-stream-response: true` header.

/** Status values for SSE stream events */
export const StreamEventStatusSchema = z
  .enum(["starting", "connected", "running", "finished", "error"])
  .meta({
    id: "StreamEventStatus",
    description: "Current status of the streaming operation",
  });

/** Type discriminator for SSE stream events */
export const StreamEventTypeSchema = z.enum(["system", "log"]).meta({
  id: "StreamEventType",
  description: "Type of stream event - system events or log messages",
});

/** Data payload for system stream events */
export const StreamEventSystemDataSchema = z
  .object({
    status: StreamEventStatusSchema,
    result: z
      .unknown()
      .optional()
      .meta({
        description: "Operation result (present when status is 'finished')",
        override: ({ jsonSchema }: { jsonSchema: Record<string, unknown> }) => {
          jsonSchema["x-stainless-any"] = true;
        },
      }),
    error: z.string().optional().meta({
      description: "Error message (present when status is 'error')",
    }),
  })
  .meta({ id: "StreamEventSystemData" });

/** Data payload for log stream events */
export const StreamEventLogDataSchema = z
  .object({
    status: z.literal("running"),
    message: z.string().meta({
      description: "Log message from the operation",
    }),
  })
  .meta({ id: "StreamEventLogData" });

/**
 * SSE stream event sent during streaming responses.
 *
 * IMPORTANT: Key ordering matters for Stainless SDK generation.
 * The `data` field MUST be serialized first, with `status` as the first key within it.
 * This allows Stainless to use `data_starts_with: '{"data":{"status":"finished"'` for event handling.
 *
 * Expected serialization order: {"data":{"status":...},"type":...,"id":...}
 */
export const StreamEventSchema = z
  .object({
    data: z.union([StreamEventSystemDataSchema, StreamEventLogDataSchema]),
    type: StreamEventTypeSchema,
    id: z.string().uuid().meta({
      description: "Unique identifier for this event",
      example: "c4dbf3a9-9a58-4b22-8a1c-9f20f9f9e123",
    }),
  })
  .meta({
    id: "StreamEvent",
    description:
      "Server-Sent Event emitted during streaming responses. Events are sent as `data: <JSON>\\n\\n`. Key order: data (with status first), type, id.",
  });

// =============================================================================
// OpenAPI Components
// =============================================================================
// These objects are exported for use in gen-openapi.ts to configure the spec.

/** OpenAPI security schemes for authentication */
export const openApiSecuritySchemes = {
  BrowserbaseApiKey: {
    type: "apiKey",
    in: "header",
    name: "x-bb-api-key",
    description: "Browserbase API key for authentication",
  },
  BrowserbaseProjectId: {
    type: "apiKey",
    in: "header",
    name: "x-bb-project-id",
    description: "Browserbase project ID",
  },
  ModelApiKey: {
    type: "apiKey",
    in: "header",
    name: "x-model-api-key",
    description: "API key for the AI model provider (OpenAI, Anthropic, etc.)",
  },
} as const;

/** OpenAPI links for session operations (used in SessionStart response) */
export const openApiLinks = {
  SessionAct: {
    operationId: "SessionAct",
    parameters: { id: "$response.body#/data/sessionId" },
    description: "Perform an action on the session",
  },
  SessionExtract: {
    operationId: "SessionExtract",
    parameters: { id: "$response.body#/data/sessionId" },
    description: "Extract data from the session",
  },
  SessionObserve: {
    operationId: "SessionObserve",
    parameters: { id: "$response.body#/data/sessionId" },
    description: "Observe available actions on the session",
  },
  SessionNavigate: {
    operationId: "SessionNavigate",
    parameters: { id: "$response.body#/data/sessionId" },
    description: "Navigate to a URL in the session",
  },
  SessionAgentExecute: {
    operationId: "SessionAgentExecute",
    parameters: { id: "$response.body#/data/sessionId" },
    description: "Execute an agent on the session",
  },
  SessionReplay: {
    operationId: "SessionReplay",
    parameters: { id: "$response.body#/data/sessionId" },
    description: "Replay session metrics",
  },
  SessionEnd: {
    operationId: "SessionEnd",
    parameters: { id: "$response.body#/data/sessionId" },
    description: "End the session and release resources",
  },
} as const;

/** OpenAPI operation metadata for each endpoint */
export const Operations = {
  SessionStart: {
    operationId: "SessionStart",
    summary: "Start a new browser session",
    description:
      "Creates a new browser session with the specified configuration. Returns a session ID used for all subsequent operations.",
  },
  SessionEnd: {
    operationId: "SessionEnd",
    summary: "End a browser session",
    description:
      "Terminates the browser session and releases all associated resources.",
  },
  SessionAct: {
    operationId: "SessionAct",
    summary: "Perform an action",
    description:
      "Executes a browser action using natural language instructions or a predefined Action object.",
  },
  SessionExtract: {
    operationId: "SessionExtract",
    summary: "Extract data from the page",
    description:
      "Extracts structured data from the current page using AI-powered analysis.",
  },
  SessionObserve: {
    operationId: "SessionObserve",
    summary: "Observe available actions",
    description:
      "Identifies and returns available actions on the current page that match the given instruction.",
  },
  SessionNavigate: {
    operationId: "SessionNavigate",
    summary: "Navigate to a URL",
    description: "Navigates the browser to the specified URL.",
  },
  SessionAgentExecute: {
    operationId: "SessionAgentExecute",
    summary: "Execute an AI agent",
    description:
      "Runs an autonomous AI agent that can perform complex multi-step browser tasks.",
  },
  SessionReplay: {
    operationId: "SessionReplay",
    summary: "Replay session metrics",
    description: "Retrieves replay metrics for a session.",
  },
} as const;

// =============================================================================
// Type Exports (inferred from schemas)
// =============================================================================

// Shared types
export type Action = z.infer<typeof ActionSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type BrowserConfig = z.infer<typeof BrowserConfigSchema>;
export type SessionIdParams = z.infer<typeof SessionIdParamsSchema>;

// Header types
export type SessionHeaders = z.infer<typeof SessionHeadersSchema>;

// Browserbase types
export type BrowserbaseViewport = z.infer<typeof BrowserbaseViewportSchema>;
export type BrowserbaseFingerprintScreen = z.infer<
  typeof BrowserbaseFingerprintScreenSchema
>;
export type BrowserbaseFingerprint = z.infer<
  typeof BrowserbaseFingerprintSchema
>;
export type BrowserbaseContext = z.infer<typeof BrowserbaseContextSchema>;
export type BrowserbaseBrowserSettings = z.infer<
  typeof BrowserbaseBrowserSettingsSchema
>;
export type BrowserbaseProxyGeolocation = z.infer<
  typeof BrowserbaseProxyGeolocationSchema
>;
export type BrowserbaseProxyConfig = z.infer<
  typeof BrowserbaseProxyConfigSchema
>;
export type ExternalProxyConfig = z.infer<typeof ExternalProxyConfigSchema>;
export type BrowserbaseRegion = z.infer<typeof BrowserbaseRegionSchema>;
export type BrowserbaseSessionCreateParams = z.infer<
  typeof BrowserbaseSessionCreateParamsSchema
>;

// Type check: ensure our schema-derived type is assignable to the SDK type
// This will cause a compile error if our schema drifts from the SDK
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _BrowserbaseSessionCreateParamsCheck =
  BrowserbaseSessionCreateParams extends Browserbase.Sessions.SessionCreateParams
    ? true
    : never;

// /sessions/start
export type SessionStartRequest = z.infer<typeof SessionStartRequestSchema>;
export type SessionStartResult = z.infer<typeof SessionStartResultSchema>;
export type SessionStartResponse = z.infer<typeof SessionStartResponseSchema>;

// /sessions/{id}/end
export type SessionEndResult = z.infer<typeof SessionEndResultSchema>;
export type SessionEndResponse = z.infer<typeof SessionEndResponseSchema>;

// /sessions/{id}/act
export type ActRequest = z.infer<typeof ActRequestSchema>;
export type ActResultData = z.infer<typeof ActResultDataSchema>;
export type ActResult = z.infer<typeof ActResultSchema>;
export type ActResponse = z.infer<typeof ActResponseSchema>;

// /sessions/{id}/extract
export type ExtractRequest = z.infer<typeof ExtractRequestSchema>;
export type ExtractResult = z.infer<typeof ExtractResultSchema>;
export type ExtractResponse = z.infer<typeof ExtractResponseSchema>;

// /sessions/{id}/observe
export type ObserveRequest = z.infer<typeof ObserveRequestSchema>;
export type ObserveResult = z.infer<typeof ObserveResultSchema>;
export type ObserveResponse = z.infer<typeof ObserveResponseSchema>;

// /sessions/{id}/agentExecute
export type AgentAction = z.infer<typeof AgentActionSchema>;
export type AgentUsage = z.infer<typeof AgentUsageSchema>;
export type AgentResultData = z.infer<typeof AgentResultDataSchema>;
export type AgentExecuteRequest = z.infer<typeof AgentExecuteRequestSchema>;
export type AgentExecuteResult = z.infer<typeof AgentExecuteResultSchema>;
export type AgentExecuteResponse = z.infer<typeof AgentExecuteResponseSchema>;

// /sessions/{id}/navigate
export type NavigateRequest = z.infer<typeof NavigateRequestSchema>;
export type NavigateResult = z.infer<typeof NavigateResultSchema>;
export type NavigateResponse = z.infer<typeof NavigateResponseSchema>;

// /sessions/{id}/replay
export type TokenUsage = z.infer<typeof TokenUsageSchema>;
export type ReplayAction = z.infer<typeof ReplayActionSchema>;
export type ReplayPage = z.infer<typeof ReplayPageSchema>;
export type ReplayResult = z.infer<typeof ReplayResultSchema>;
export type ReplayResponse = z.infer<typeof ReplayResponseSchema>;

// SSE Stream Events
export type StreamEventStatus = z.infer<typeof StreamEventStatusSchema>;
export type StreamEventType = z.infer<typeof StreamEventTypeSchema>;
export type StreamEventSystemData = z.infer<typeof StreamEventSystemDataSchema>;
export type StreamEventLogData = z.infer<typeof StreamEventLogDataSchema>;
export type StreamEvent = z.infer<typeof StreamEventSchema>;
