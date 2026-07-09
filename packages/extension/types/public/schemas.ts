import { z } from "zod/v4";

export const AvailableModelSchema = z.string().meta({ id: "AvailableModel" });

export const ApiKeyAuthSchema = z
  .object({
    type: z.literal("apiKey"),
    apiKey: z.string().min(1),
  })
  .strict()
  .meta({ id: "ApiKeyAuth" });

export const OpenAIClientOptionsSchema = z
  .object({
    baseURL: z.string().optional(),
    organization: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    auth: ApiKeyAuthSchema,
  })
  .strict()
  .meta({ id: "OpenAIClientOptions" });

export const AnthropicClientOptionsSchema = z
  .object({
    baseURL: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    auth: ApiKeyAuthSchema,
  })
  .strict()
  .meta({ id: "AnthropicClientOptions" });

export const ModelProviderSchema = z
  .enum(["openai", "anthropic", "cerebras", "groq", "google"])
  .meta({ id: "ModelProvider" });

export const ThinkingEffortSchema = z
  .enum(["none", "low", "medium", "high", "xhigh", "max"])
  .meta({ id: "ThinkingEffort" });

export const V3FunctionNameSchema = z.enum(["ACT", "EXTRACT", "OBSERVE"]).meta({
  id: "V3FunctionName",
});

export const VariablePrimitiveSchema = z
  .union([z.string(), z.number(), z.boolean()])
  .meta({ id: "VariablePrimitive" });

export const VariableValueSchema = z
  .union([
    VariablePrimitiveSchema,
    z
      .object({
        value: VariablePrimitiveSchema,
        description: z.string().optional(),
      })
      .strict(),
  ])
  .meta({ id: "VariableValue" });

export const VariablesSchema = z.record(z.string(), VariableValueSchema).meta({ id: "Variables" });

const staleLocatorHandleFields = ["page", "frame", "element"] as const;

export const LocatorCoordinatesSchema = z
  .object({
    x: z.number().nullable().optional(),
    y: z.number().nullable().optional(),
    top: z.number().nullable().optional(),
    left: z.number().nullable().optional(),
    bottom: z.number().nullable().optional(),
    right: z.number().nullable().optional(),
  })
  .strict()
  .meta({ id: "LocatorCoordinates" });

const PageLocatorKnownSchema = z.object({
  page_idx: z.number().int().nonnegative().nullable().optional(),
  url: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  active: z.boolean().nullable().optional(),
  targetId: z.string().nullable().optional(),
  tabId: z.number().int().nonnegative().nullable().optional(),
  frameId: z.string().nullable().optional(),
});

export const PageLocatorSchema = PageLocatorKnownSchema.passthrough()
  .superRefine((value, ctx) => {
    for (const key of staleLocatorHandleFields) {
      if (key in value) {
        ctx.addIssue({
          code: "custom",
          message: `Unrecognized key: "${key}"`,
          path: [key],
        });
      }
    }
  })
  .meta({ id: "PageLocator" }) as unknown as typeof PageLocatorKnownSchema;

export const LocatorSchema = PageLocatorSchema.extend({
  idx: z.number().int().nonnegative().nullable().optional(),
  frame_idx: z.number().int().nonnegative().nullable().optional(),
  xpath: z.string().nullable().optional(),
  css: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  react_element_name: z.string().nullable().optional(),
  coordinates: LocatorCoordinatesSchema.nullable().optional(),
  snapshot_id: z.string().uuid().nullable().optional(),
  element_id: z
    .string()
    .regex(/^(?:p\d+:)?\d+-\d+$/)
    .nullable()
    .optional(),
  backendNodeId: z.number().int().nonnegative().nullable().optional(),
}).meta({ id: "Locator" });

export const ClipboardOptionsSchema = z
  .object({
    locator: PageLocatorSchema.optional(),
  })
  .strict()
  .meta({ id: "ClipboardOptions" });

export const ClipboardPasteOptionsSchema = ClipboardOptionsSchema.extend({
  shortcut: z.enum(["ControlOrMeta+V", "Meta+V", "Control+V"]).optional(),
}).meta({ id: "ClipboardPasteOptions" });

export const defaultExtractSchema = z.object({
  extraction: z.string(),
});

export const pageTextSchema = z.object({
  pageText: z.string(),
});

export const HistoryEntrySchema = z
  .object({
    method: z.enum(["act", "extract", "observe", "navigate"]),
    parameters: z.unknown(),
    result: z.unknown(),
    timestamp: z.string(),
  })
  .strict()
  .meta({ id: "HistoryEntry" });

export const CookieSchema = z
  .object({
    name: z.string(),
    value: z.string(),
    domain: z.string(),
    path: z.string(),
    expires: z.number(),
    httpOnly: z.boolean(),
    secure: z.boolean(),
    sameSite: z.enum(["Strict", "Lax", "None"]),
  })
  .strict()
  .meta({ id: "Cookie" });

export const CookieParamSchema = z
  .object({
    name: z.string(),
    value: z.string(),
    url: z.string().optional(),
    domain: z.string().optional(),
    path: z.string().optional(),
    expires: z.number().optional(),
    httpOnly: z.boolean().optional(),
    secure: z.boolean().optional(),
    sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
  })
  .strict()
  .meta({ id: "CookieParam" });

export const ClearCookieOptionsSchema = z
  .object({
    name: z.string().optional(),
    domain: z.string().optional(),
    path: z.string().optional(),
  })
  .strict()
  .meta({ id: "ClearCookieOptions" });

export const DomainPolicySchema = z
  .object({
    allowedDomains: z.array(z.string()).optional(),
    blockedDomains: z.array(z.string()).optional(),
  })
  .strict()
  .meta({ id: "DomainPolicy" });

export const LogLevelSchema = z
  .union([z.literal(0), z.literal(1), z.literal(2)])
  .meta({ id: "LogLevel" });

export const LogLineSchema = z
  .object({
    id: z.string().optional(),
    category: z.string().optional(),
    message: z.string(),
    level: LogLevelSchema.optional(),
    timestamp: z.string().optional(),
    auxiliary: z
      .record(
        z.string(),
        z
          .object({
            value: z.string(),
            type: z.enum(["object", "string", "html", "integer", "float", "boolean"]),
          })
          .strict(),
      )
      .optional(),
  })
  .strict()
  .meta({ id: "LogLine" });

export const StagehandMetricsSchema = z
  .object({
    actPromptTokens: z.number(),
    actCompletionTokens: z.number(),
    actReasoningTokens: z.number(),
    actCachedInputTokens: z.number(),
    actInferenceTimeMs: z.number(),
    extractPromptTokens: z.number(),
    extractCompletionTokens: z.number(),
    extractReasoningTokens: z.number(),
    extractCachedInputTokens: z.number(),
    extractInferenceTimeMs: z.number(),
    observePromptTokens: z.number(),
    observeCompletionTokens: z.number(),
    observeReasoningTokens: z.number(),
    observeCachedInputTokens: z.number(),
    observeInferenceTimeMs: z.number(),
    totalPromptTokens: z.number(),
    totalCompletionTokens: z.number(),
    totalReasoningTokens: z.number(),
    totalCachedInputTokens: z.number(),
    totalInferenceTimeMs: z.number(),
  })
  .strict()
  .meta({ id: "StagehandMetrics" });

export const LoadStateSchema = z
  .enum(["load", "domcontentloaded", "networkidle"])
  .meta({ id: "LoadState" });

export const SnapshotResultSchema = z
  .object({
    formattedTree: z.string(),
    xpathMap: z.record(z.string(), z.string()),
    urlMap: z.record(z.string(), z.string()),
  })
  .strict()
  .meta({ id: "SnapshotResult" });

export const PageSnapshotOptionsSchema = z
  .object({
    includeIframes: z.boolean().optional(),
  })
  .strict()
  .meta({ id: "PageSnapshotOptions" });

const CacheStatusSchema = z.enum(["HIT", "MISS"]);

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
    cdpHeaders: z.record(z.string(), z.string()).optional(),
    connectTimeoutMs: z.number().optional(),
    downloadsPath: z.string().optional(),
    acceptDownloads: z.boolean().optional(),
  })
  .strict()
  .meta({ id: "LocalBrowserLaunchOptions" });

/** Detailed model configuration object */
export const GoogleServiceAccountCredentialsSchema = z
  .object({
    type: z.literal("service_account").optional(),
    project_id: z.string().optional(),
    private_key_id: z.string().optional(),
    private_key: z.string(),
    client_email: z.string(),
    client_id: z.string().optional(),
    auth_uri: z.url().optional(),
    token_uri: z.url().optional(),
    auth_provider_x509_cert_url: z.url().optional(),
    client_x509_cert_url: z.url().optional(),
    universe_domain: z.string().optional(),
  })
  .strict()
  .meta({ id: "GoogleServiceAccountCredentials" });

export const GoogleServiceAccountAuthSchema = z
  .object({
    type: z.literal("googleServiceAccount").meta({
      description:
        "Use inline Google Cloud service account credentials for provider authentication",
    }),
    credentials: GoogleServiceAccountCredentialsSchema.meta({
      description: "Google Cloud service account credentials",
    }),
    scopes: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .meta({
        description: "Google auth scopes for the desired API request",
      }),
    projectId: z.string().optional().meta({
      description: "Google Cloud project ID used by google-auth-library",
    }),
    universeDomain: z.string().optional().meta({
      description: "Google Cloud universe domain",
    }),
  })
  .strict()
  .meta({ id: "GoogleServiceAccountAuth" });

export const AzureEntraIdAuthSchema = z
  .object({
    type: z.literal("azureEntraId").meta({
      description: "Use a Microsoft Entra ID bearer token for authentication",
    }),
    token: z.string().min(1).meta({
      description: "Microsoft Entra ID bearer token for Azure OpenAI",
    }),
  })
  .strict()
  .meta({ id: "AzureEntraIdAuth" });

export const ModelAuthSchema = z
  .discriminatedUnion("type", [
    ApiKeyAuthSchema,
    GoogleServiceAccountAuthSchema,
    AzureEntraIdAuthSchema,
  ])
  .meta({ id: "ModelAuth" });

export const VertexProviderOptionsSchema = z
  .object({
    project: z.string().meta({
      description: "Google Cloud project ID for Vertex AI models",
      example: "my-gcp-project",
    }),
    location: z.string().meta({
      description: "Google Cloud location for Vertex AI models",
      example: "us-central1",
    }),
    baseURL: z.string().url().optional().meta({
      description: "Base URL for the Vertex AI provider",
    }),
    headers: z.record(z.string(), z.string()).optional().meta({
      description: "Custom headers sent with every request to the Vertex AI provider",
    }),
  })
  .strict()
  .meta({ id: "VertexProviderOptions" });

export const AzureProviderOptionsSchema = z
  .object({
    resourceName: z.string().optional().meta({
      description: "Azure OpenAI resource name",
      example: "my-azure-openai-resource",
    }),
    baseURL: z.string().url().optional().meta({
      description: "Base URL for the Azure OpenAI provider",
    }),
    apiVersion: z.string().optional().meta({
      description: "Azure OpenAI API version",
      example: "2024-10-01-preview",
    }),
    useDeploymentBasedUrls: z.boolean().optional().meta({
      description: "Whether to use deployment-based Azure OpenAI URLs",
    }),
    headers: z.record(z.string(), z.string()).optional().meta({
      description: "Custom headers sent with every request to the Azure OpenAI provider",
    }),
  })
  .strict()
  .meta({ id: "AzureProviderOptions" });

export const VertexModelProviderOptionsSchema = z
  .object({
    type: z.literal("vertex"),
    options: VertexProviderOptionsSchema.meta({
      description: "Vertex AI provider-specific settings",
    }),
  })
  .strict()
  .meta({ id: "VertexModelProviderOptions" });

export const AzureModelProviderOptionsSchema = z
  .object({
    type: z.literal("azure"),
    options: AzureProviderOptionsSchema.meta({
      description: "Azure OpenAI provider-specific settings",
    }),
  })
  .strict()
  .meta({ id: "AzureModelProviderOptions" });

export const ModelProviderOptionsSchema = z
  .discriminatedUnion("type", [VertexModelProviderOptionsSchema, AzureModelProviderOptionsSchema])
  .meta({ id: "ModelProviderOptions" });

export const LLMToolSchema = z
  .object({
    type: z.literal("function"),
    name: z.string(),
    description: z.string(),
    parameters: z.record(z.string(), z.unknown()),
  })
  .required()
  .meta({ id: "LLMTool" });

export const ClientOptionsBaseSchema = z
  .object({
    provider: ModelProviderSchema.optional(),
    auth: ModelAuthSchema.optional(),
    providerOptions: ModelProviderOptionsSchema.optional(),
    baseURL: z.string().optional(),
    organization: z.string().optional(),
    thinkingBudget: z.number().optional(),
    thinkingEffort: ThinkingEffortSchema.optional(),
    temperature: z.number().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    reasoningEffort: z.string().optional(),
  })
  .strict()
  .meta({ id: "ClientOptionsBase" });

export const ClientOptionsSchema = ClientOptionsBaseSchema.default({}).meta({
  id: "ClientOptions",
});

export const ApiKeyClientOptionsSchema = ClientOptionsBaseSchema.extend({
  auth: ApiKeyAuthSchema,
})
  .strict()
  .meta({ id: "ApiKeyClientOptions" });

export const VertexClientOptionsSchema = ClientOptionsBaseSchema.extend({
  auth: GoogleServiceAccountAuthSchema,
  providerOptions: VertexModelProviderOptionsSchema,
})
  .strict()
  .meta({ id: "VertexClientOptions" });

export const AzureApiKeyClientOptionsSchema = ClientOptionsBaseSchema.extend({
  auth: ApiKeyAuthSchema,
  providerOptions: AzureModelProviderOptionsSchema,
})
  .strict()
  .meta({ id: "AzureApiKeyClientOptions" });

export const AzureEntraClientOptionsSchema = ClientOptionsBaseSchema.extend({
  auth: AzureEntraIdAuthSchema,
  providerOptions: AzureModelProviderOptionsSchema,
})
  .strict()
  .meta({ id: "AzureEntraClientOptions" });

export const AISDKApiKeyProviderSchema = z.enum([
  "openai",
  "bedrock",
  "anthropic",
  "google",
  "xai",
  "groq",
  "cerebras",
  "togetherai",
  "mistral",
  "deepseek",
  "perplexity",
  "gateway",
]);

export const ApiKeyResolvedProviderClientOptionsSchema = z
  .object({
    provider: AISDKApiKeyProviderSchema,
    clientOptions: ApiKeyClientOptionsSchema,
  })
  .strict()
  .meta({ id: "ApiKeyResolvedProviderClientOptions" });

export const AzureResolvedProviderClientOptionsSchema = z
  .object({
    provider: z.literal("azure"),
    clientOptions: z.union([AzureApiKeyClientOptionsSchema, AzureEntraClientOptionsSchema]),
  })
  .strict()
  .meta({ id: "AzureResolvedProviderClientOptions" });

export const VertexResolvedProviderClientOptionsSchema = z
  .object({
    provider: z.literal("vertex"),
    clientOptions: VertexClientOptionsSchema,
  })
  .strict()
  .meta({ id: "VertexResolvedProviderClientOptions" });

export const OllamaResolvedProviderClientOptionsSchema = z
  .object({
    provider: z.literal("ollama"),
    clientOptions: ClientOptionsBaseSchema,
  })
  .strict()
  .meta({ id: "OllamaResolvedProviderClientOptions" });

export const ResolvedProviderClientOptionsSchema = z
  .discriminatedUnion("provider", [
    ApiKeyResolvedProviderClientOptionsSchema,
    AzureResolvedProviderClientOptionsSchema,
    VertexResolvedProviderClientOptionsSchema,
    OllamaResolvedProviderClientOptionsSchema,
  ])
  .meta({ id: "ResolvedProviderClientOptions" });

const ModelConfigBaseSchema = z
  .object({
    modelName: z.string().meta({
      description: "Model name string with provider prefix (e.g., 'openai/gpt-5-nano')",
      example: "openai/gpt-5.4-mini",
    }),
    apiKey: z.string().optional().meta({
      description: "API key for the model provider",
      example: "sk-some-openai-api-key",
    }),
    baseURL: z.string().url().optional().meta({
      description: "Base URL for the model provider",
      example: "https://api.openai.com/v1",
    }),
    headers: z.record(z.string(), z.string()).optional().meta({
      description: "Custom headers sent with every request to the model provider",
    }),
  })
  .strict();

export const GenericModelConfigObjectSchema = ModelConfigBaseSchema.extend({
  provider: z.enum(["openai", "anthropic", "cerebras", "groq", "google"]).optional().meta({
    description: "AI provider for the model (or provide a baseURL endpoint instead)",
    example: "openai",
  }),
})
  .strict()
  .meta({ id: "GenericModelConfigObject" });

export const VertexModelConfigObjectSchema = ModelConfigBaseSchema.extend({
  provider: z.literal("vertex").meta({
    description: "Vertex AI model provider",
  }),
  auth: GoogleServiceAccountAuthSchema.meta({
    description: "Vertex provider authentication configuration",
  }),
  providerOptions: VertexModelProviderOptionsSchema.meta({
    description: "Vertex provider-specific model configuration",
  }),
})
  .strict()
  .meta({ id: "VertexModelConfigObject" });

const AzureModelConfigBaseSchema = ModelConfigBaseSchema.extend({
  provider: z.literal("azure").meta({
    description: "Azure OpenAI model provider",
  }),
  providerOptions: AzureModelProviderOptionsSchema.meta({
    description: "Azure provider-specific model configuration",
  }),
}).strict();

export const AzureEntraModelConfigObjectSchema = AzureModelConfigBaseSchema.omit({ apiKey: true })
  .extend({
    auth: AzureEntraIdAuthSchema.meta({
      description: "Azure provider authentication configuration",
    }),
  })
  .strict()
  .meta({ id: "AzureEntraModelConfigObject" });

export const AzureApiKeyModelConfigObjectSchema = AzureModelConfigBaseSchema.strict().meta({
  id: "AzureApiKeyModelConfigObject",
});

export const AzureModelConfigObjectSchema = z
  .union([AzureEntraModelConfigObjectSchema, AzureApiKeyModelConfigObjectSchema])
  .meta({ id: "AzureModelConfigObject" });

export const ModelConfigObjectSchema = z
  .union([
    VertexModelConfigObjectSchema,
    AzureModelConfigObjectSchema,
    GenericModelConfigObjectSchema,
  ])
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
      description: "Chrome DevTools Protocol URL for connecting to existing browser",
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
const wrapResponse = <T extends z.ZodType>(resultSchema: T, name: string) =>
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
    browsers: z.array(z.enum(["chrome", "edge", "firefox", "safari"])).optional(),
    devices: z.array(z.enum(["desktop", "mobile"])).optional(),
    httpVersion: z.enum(["1", "2"]).optional(),
    locales: z.array(z.string()).optional(),
    operatingSystems: z.array(z.enum(["android", "ios", "linux", "macos", "windows"])).optional(),
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
    captchaImageSelector: z.string().optional(),
    captchaInputSelector: z.string().optional(),
    context: BrowserbaseContextSchema.optional(),
    extensionId: z.string().optional(),
    fingerprint: BrowserbaseFingerprintSchema.optional(),
    logSession: z.boolean().optional(),
    os: z.enum(["windows", "mac", "linux", "mobile", "tablet"]).optional(),
    recordSession: z.boolean().optional(),
    solveCaptchas: z.boolean().optional(),
    verified: z.boolean().optional(),
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
  .discriminatedUnion("type", [BrowserbaseProxyConfigSchema, ExternalProxyConfigSchema])
  .meta({ id: "ProxyConfig" });

/** Browserbase region identifier for multi-region support */
export const BrowserbaseRegionSchema = z
  .enum(["us-west-2", "us-east-1", "eu-central-1", "ap-southeast-1"])
  .meta({ id: "BrowserbaseRegion" });
export type BrowserbaseRegion = z.infer<typeof BrowserbaseRegionSchema>;

/** Browserbase session creation parameters */
export const BrowserbaseSessionCreateParamsSchema = z
  .object({
    projectId: z.string().optional().meta({
      deprecated: true,
      description:
        "Deprecated. Browserbase API keys are now project-scoped, so this field is no longer required.",
    }),
    browserSettings: BrowserbaseBrowserSettingsSchema.optional(),
    extensionId: z.string().optional(),
    keepAlive: z.boolean().optional(),
    proxies: z.union([z.boolean(), z.array(ProxyConfigSchema)]).optional(),
    region: BrowserbaseRegionSchema.optional(),
    timeout: z.number().optional(),
    userMetadata: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: "BrowserbaseSessionCreateParams" });
export type BrowserbaseSessionCreateParams = z.infer<typeof BrowserbaseSessionCreateParamsSchema>;

export const V3EnvSchema = z.enum(["LOCAL", "BROWSERBASE"]).meta({ id: "V3Env" });

export const V3OptionsSchema = z
  .object({
    env: V3EnvSchema,
    sessionId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string().optional(),
    browserbaseSessionCreateParams: BrowserbaseSessionCreateParamsSchema.optional(),
    browserbaseSessionID: z.string().optional(),
    keepAlive: z.boolean().optional(),
    localBrowserLaunchOptions: LocalBrowserLaunchOptionsSchema.optional(),
    model: ModelConfigSchema.optional(),
    systemPrompt: z.string().optional(),
    logInferenceToFile: z.boolean().optional(),
    experimental: z.boolean().optional(),
    verbose: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    selfHeal: z.boolean().optional(),
    waitForCaptchaSolves: z.boolean().optional(),
    actTimeoutMs: z.number().optional(),
    disablePino: z.boolean().optional(),
    cacheDir: z.string().optional(),
    domSettleTimeout: z.number().optional(),
    disableAPI: z.boolean().optional(),
    serverCache: z.boolean().optional(),
  })
  .strict()
  .meta({ id: "V3Options" });

// =============================================================================
// Session Start
// =============================================================================

export const SessionStartRequestSchema = z
  .object({
    modelName: z.string().meta({
      description: "Model name to use for AI operations",
      example: "openai/gpt-5.4-mini",
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
    browserbaseSessionCreateParams: BrowserbaseSessionCreateParamsSchema.optional(),
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

export const SessionEndResultSchema = z.object({}).strict().meta({ id: "SessionEndResult" });

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
    model: ModelConfigSchema.optional().meta({
      description: "Model configuration object",
    }),
    variables: VariablesSchema.optional().meta({
      description:
        "Variables to substitute in the action instruction. Accepts flat primitives or { value, description? } objects.",
      example: {
        username: "john_doe",
        password: {
          value: "secret123",
          description: "The login password",
        },
      },
    }),
    timeout: z.number().optional().meta({
      description: "Timeout in ms for the action",
      example: 30000,
    }),
    locator: LocatorSchema.optional().meta({
      description: "Serializable page or element locator for the action target",
    }),
    serverCache: z.boolean().optional().meta({
      description: "Override the instance-level serverCache setting for this request",
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
    cacheStatus: CacheStatusSchema.optional().meta({
      description: "Server-side cache status for this result",
    }),
  })
  .meta({ id: "ActResult" });

export const ActResponseSchema = wrapResponse(ActResultSchema, "ActResponse");

// =============================================================================
// Extract
// =============================================================================

export const ExtractOptionsSchema = z
  .object({
    model: ModelConfigSchema.optional().meta({
      description: "Model configuration object",
    }),
    timeout: z.number().optional().meta({
      description: "Timeout in ms for the extraction",
      example: 30000,
    }),
    selector: z.string().optional().meta({
      description: "CSS selector to scope extraction to a specific element",
      example: "#main-content",
    }),
    ignoreSelectors: z
      .array(z.string())
      .optional()
      .meta({
        description: "Selectors for elements and subtrees that should be excluded from extraction",
        example: ["nav", ".cookie-banner", "#sidebar-ads"],
      }),
    screenshot: z.boolean().optional().meta({
      description:
        "When true, include a screenshot of the current viewport in the extraction LLM call. Defaults to false.",
      example: false,
    }),
    locator: LocatorSchema.optional().meta({
      description: "Serializable page or element locator for the extraction target",
    }),
    serverCache: z.boolean().optional().meta({
      description: "Override the instance-level serverCache setting for this request",
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
    cacheStatus: CacheStatusSchema.optional().meta({
      description: "Server-side cache status for this result",
    }),
  })
  .meta({ id: "ExtractResult" });

export const ExtractResponseSchema = wrapResponse(ExtractResultSchema, "ExtractResponse");

// =============================================================================
// Observe
// =============================================================================

export const ObserveOptionsSchema = z
  .object({
    model: ModelConfigSchema.optional().meta({
      description: "Model configuration object",
    }),
    variables: VariablesSchema.optional().meta({
      description:
        "Variables whose names are exposed to the model so observe() returns %variableName% placeholders in suggested action arguments instead of literal values. Accepts flat primitives or { value, description? } objects.",
      example: {
        username: {
          value: "john@example.com",
          description: "The login email",
        },
        rememberMe: true,
      },
    }),
    timeout: z.number().optional().meta({
      description: "Timeout in ms for the observation",
      example: 30000,
    }),
    selector: z.string().optional().meta({
      description: "CSS selector to scope observation to a specific element",
      example: "nav",
    }),
    ignoreSelectors: z
      .array(z.string())
      .optional()
      .meta({
        description: "Selectors for elements and subtrees that should be excluded from observation",
        example: ["nav", ".cookie-banner", "#sidebar-ads"],
      }),
    locator: LocatorSchema.optional().meta({
      description: "Serializable page or element locator for the observation target",
    }),
    serverCache: z.boolean().optional().meta({
      description: "Override the instance-level serverCache setting for this request",
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
    cacheStatus: CacheStatusSchema.optional().meta({
      description: "Server-side cache status for this result",
    }),
  })
  .meta({ id: "ObserveResult" });

export const ObserveResponseSchema = wrapResponse(ObserveResultSchema, "ObserveResponse");

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
    waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional().meta({
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

export const NavigateResponseSchema = wrapResponse(NavigateResultSchema, "NavigateResponse");

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

export const ReplayResponseSchema = wrapResponse(ReplayResultSchema, "ReplayResponse");

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
 * The SSE wire format includes an `event:` line that mirrors the stream status
 * (`starting`, `connected`, `running`, `finished`, or `error`) followed by a
 * JSON `data:` line containing the typed payload below.
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
      "Server-Sent Event emitted during streaming responses. Events are sent as `event: <status>\\ndata: <JSON>\\n\\n`, where the JSON payload has the shape `{ data, type, id }`.",
  });
