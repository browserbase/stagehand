import { z } from "zod/v4";

export const ModelProviderSchema = z
  .enum([
    "openai",
    "bedrock",
    "anthropic",
    "google",
    "vertex",
    "xai",
    "azure",
    "groq",
    "cerebras",
    "togetherai",
    "mistral",
    "deepseek",
    "perplexity",
    "ollama",
    "gateway",
  ])
  .meta({ id: "ModelProvider" });

export const ModelNameSchema = z
  .templateLiteral([ModelProviderSchema, "/", z.string().min(1)])
  .meta({
    id: "ModelName",
    description: "Model name with a required provider prefix (for example, 'openai/gpt-5')",
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
  pageIdx: z.number().int().nonnegative().nullable().optional(),
  url: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  active: z.boolean().nullable().optional(),
  targetId: z.string().nullable().optional(),
  tabId: z.number().int().nonnegative().nullable().optional(),
  frameId: z.string().nullable().optional(),
});

export const PageLocatorSchema = PageLocatorKnownSchema.loose()
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
  frameIdx: z.number().int().nonnegative().nullable().optional(),
  xpath: z.string().nullable().optional(),
  css: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  reactElementName: z.string().nullable().optional(),
  coordinates: LocatorCoordinatesSchema.nullable().optional(),
  snapshotId: z.uuid().nullable().optional(),
  elementId: z
    .string()
    .regex(/^(?:p\d+:)?\d+-\d+$/)
    .nullable()
    .optional(),
}).meta({ id: "Locator" });

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

const CacheStatusSchema = z.enum(["HIT", "MISS"]);

/** Detailed model configuration object */
export const GoogleServiceAccountCredentialsSchema = z
  .object({
    type: z.literal("service_account").optional(),
    projectId: z.string().optional(),
    privateKeyId: z.string().optional(),
    privateKey: z.string(),
    clientEmail: z.string(),
    clientId: z.string().optional(),
    authUri: z.url().optional(),
    tokenUri: z.url().optional(),
    authProviderX509CertUrl: z.url().optional(),
    clientX509CertUrl: z.url().optional(),
    universeDomain: z.string().optional(),
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
    baseURL: z.url().optional().meta({
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
    baseURL: z.url().optional().meta({
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

const ModelConfigBaseSchema = z
  .object({
    modelName: ModelNameSchema.meta({
      description: "Model name string with provider prefix (e.g., 'openai/gpt-5-nano')",
      example: "openai/gpt-5.4-mini",
    }),
    apiKey: z.string().optional().meta({
      description: "API key for the model provider",
      example: "sk-some-openai-api-key",
    }),
    baseURL: z.url().optional().meta({
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

export const EmptyParamsSchema = z.object({}).strict();

export const PageRefSchema = z
  .object({
    pageId: z.string(),
    url: z.string().optional(),
    title: z.string().optional(),
  })
  .strict();

export const LocatorDescriptorSchema = z
  .object({
    pageId: z.string(),
    selector: z.string().min(1),
  })
  .strict();

export const StagehandInitParamsSchema = z
  .object({
    cdpUrl: z.string().min(1),
    model: ModelConfigSchema.optional(),
    sessionId: z.string().optional(),
    systemPrompt: z.string().optional(),
    logInferenceToFile: z.boolean().optional(),
    experimental: z.boolean().optional(),
    selfHeal: z.boolean().optional(),
    domSettleTimeoutMs: z.number().int().positive().optional(),
  })
  .strict();

export const RuntimeConfigureParamsSchema = z
  .object({
    cdpUrl: z.string().min(1),
  })
  .strict();

export const StagehandActParamsSchema = z
  .object({
    input: z.string().min(1),
    options: ActOptionsSchema,
  })
  .strict();

export const StagehandObserveParamsSchema = z
  .object({
    instruction: z.string().optional(),
    options: ObserveOptionsSchema,
  })
  .strict();

export const StagehandExtractParamsSchema = z
  .object({
    instruction: z.string().optional(),
    options: ExtractOptionsSchema,
  })
  .strict();

export const ContextNewPageParamsSchema = z
  .object({
    url: z.string().optional(),
  })
  .strict();

export const PageGotoParamsSchema = z
  .object({
    pageId: z.string(),
    url: z.string().min(1),
    options: z
      .object({
        waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
        timeoutMs: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const PageIdParamsSchema = z
  .object({
    pageId: z.string(),
  })
  .strict();

export const LocatorClickParamsSchema = LocatorDescriptorSchema.extend({
  options: z
    .object({
      button: z.enum(["left", "right", "middle"]).optional(),
      clickCount: z.number().int().positive().optional(),
    })
    .strict()
    .optional(),
}).strict();

export const LocatorFillParamsSchema = LocatorDescriptorSchema.extend({
  value: z.string(),
}).strict();

export const StagehandPingResultSchema = z
  .object({
    ok: z.literal(true),
    runtime: z.literal("service_worker"),
  })
  .strict();

export const RuntimeConfigureResultSchema = z
  .object({
    configured: z.literal(true),
  })
  .strict();

export const RuntimeLoopbackStatusResultSchema = z
  .object({
    configured: z.boolean(),
    connected: z.boolean(),
  })
  .strict();

export const BrowserGetVersionResultSchema = z
  .object({
    protocolVersion: z.string().optional(),
    product: z.string().optional(),
    revision: z.string().optional(),
    userAgent: z.string().optional(),
    jsVersion: z.string().optional(),
  })
  .strict();

export const StagehandInitResultSchema = z
  .object({
    initialized: z.literal(true),
    pages: z.array(PageRefSchema),
  })
  .strict();

export const StagehandCloseResultSchema = z
  .object({
    closed: z.literal(true),
  })
  .strict();

export const ContextPagesResultSchema = z.array(PageRefSchema);

export const PageUrlResultSchema = z
  .object({
    url: z.string(),
  })
  .strict();

export const PageTitleResultSchema = z
  .object({
    title: z.string(),
  })
  .strict();

export const PageCloseResultSchema = z
  .object({
    closed: z.literal(true),
  })
  .strict();

export const LocatorClickResultSchema = z
  .object({
    clicked: z.literal(true),
  })
  .strict();

export const LocatorFillResultSchema = z
  .object({
    filled: z.literal(true),
  })
  .strict();

export const LocatorIsVisibleResultSchema = z
  .object({
    visible: z.boolean(),
  })
  .strict();

export const LocatorTextContentResultSchema = z
  .object({
    textContent: z.string(),
  })
  .strict();

const TraceIdSchema = z.string().regex(/^(?!0{32}$)[0-9a-f]{32}$/);
const SpanIdSchema = z.string().regex(/^(?!0{16}$)[0-9a-f]{16}$/);

export const StagehandLogEventSchema = z
  .strictObject({
    requestId: z.union([z.string(), z.int()]),
    method: z.string(),
    eventName: z.string().min(1),
    timestamp: z.iso.datetime({ offset: true }),
    severityNumber: z.int().min(1).max(24),
    body: z.json(),
    severityText: z.string().optional(),
    attributes: z.record(z.string(), z.json()).optional(),
    traceId: TraceIdSchema.optional(),
    spanId: SpanIdSchema.optional(),
  })
  .superRefine((event, context) => {
    if (event.spanId && !event.traceId) {
      context.addIssue({
        code: "custom",
        path: ["spanId"],
        message: "spanId requires traceId",
      });
    }
  });
