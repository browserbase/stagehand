import { z } from "zod/v4";

// Seeded from the explicit model IDs in Vercel AI SDK's provider packages.
// Stagehand owns these allowlists: changes are reviewed and maintained here
// rather than inherited automatically from the SDK.
export const OpenAIModelIdSchema = z
  .enum([
    "gpt-4.1",
    "gpt-4.1-2025-04-14",
    "gpt-4.1-mini",
    "gpt-4.1-mini-2025-04-14",
    "gpt-4.1-nano",
    "gpt-4.1-nano-2025-04-14",
    "gpt-4o",
    "gpt-4o-2024-05-13",
    "gpt-4o-2024-08-06",
    "gpt-4o-2024-11-20",
    "gpt-4o-audio-preview",
    "gpt-4o-audio-preview-2024-12-17",
    "gpt-4o-search-preview",
    "gpt-4o-search-preview-2025-03-11",
    "gpt-4o-mini-search-preview",
    "gpt-4o-mini-search-preview-2025-03-11",
    "gpt-4o-mini",
    "gpt-4o-mini-2024-07-18",
    "gpt-3.5-turbo-0125",
    "gpt-3.5-turbo",
    "gpt-3.5-turbo-1106",
    "gpt-5-chat-latest",
    "o1",
    "o1-2024-12-17",
    "o3",
    "o3-2025-04-16",
    "o3-mini",
    "o3-mini-2025-01-31",
    "o4-mini",
    "o4-mini-2025-04-16",
    "gpt-5",
    "gpt-5-2025-08-07",
    "gpt-5-codex",
    "gpt-5-mini",
    "gpt-5-mini-2025-08-07",
    "gpt-5-nano",
    "gpt-5-nano-2025-08-07",
    "gpt-5-pro",
    "gpt-5-pro-2025-10-06",
    "gpt-5.1",
    "gpt-5.1-chat-latest",
    "gpt-5.1-codex-mini",
    "gpt-5.1-codex",
    "gpt-5.1-codex-max",
    "gpt-5.2",
    "gpt-5.2-chat-latest",
    "gpt-5.2-pro",
    "gpt-5.2-codex",
    "gpt-5.3-chat-latest",
    "gpt-5.3-codex",
    "gpt-5.4",
    "gpt-5.4-2026-03-05",
    "gpt-5.4-mini",
    "gpt-5.4-mini-2026-03-17",
    "gpt-5.4-nano",
    "gpt-5.4-nano-2026-03-17",
    "gpt-5.4-pro",
    "gpt-5.4-pro-2026-03-05",
    "gpt-5.5",
    "gpt-5.5-2026-04-23",
    "gpt-5.6",
    "gpt-5.6-luna",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
  ])
  .meta({ id: "OpenAIModelId" });

export const AnthropicModelIdSchema = z
  .enum([
    "claude-3-haiku-20240307",
    "claude-haiku-4-5-20251001",
    "claude-haiku-4-5",
    "claude-opus-4-0",
    "claude-opus-4-20250514",
    "claude-opus-4-1-20250805",
    "claude-opus-4-1",
    "claude-opus-4-5",
    "claude-opus-4-5-20251101",
    "claude-sonnet-4-0",
    "claude-sonnet-4-20250514",
    "claude-sonnet-4-5-20250929",
    "claude-sonnet-4-5",
    "claude-sonnet-4-6",
    "claude-opus-4-6",
    "claude-opus-4-7",
    "claude-opus-4-8",
    "claude-fable-5",
    "claude-sonnet-5",
  ])
  .meta({ id: "AnthropicModelId" });

export const GoogleModelIdSchema = z
  .enum([
    "gemini-2.0-flash",
    "gemini-2.0-flash-001",
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash-lite-001",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-image",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash-preview-tts",
    "gemini-2.5-pro-preview-tts",
    "gemini-2.5-flash-native-audio-latest",
    "gemini-2.5-flash-native-audio-preview-09-2025",
    "gemini-2.5-flash-native-audio-preview-12-2025",
    "gemini-2.5-computer-use-preview-10-2025",
    "gemini-3-pro-preview",
    "gemini-3-pro-image-preview",
    "gemini-3-flash-preview",
    "gemini-3.1-pro-preview",
    "gemini-3.1-pro-preview-customtools",
    "gemini-3.1-flash-image-preview",
    "gemini-3.1-flash-lite-preview",
    "gemini-3.1-flash-tts-preview",
    "gemini-3.5-flash",
    "gemini-pro-latest",
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
    "deep-research-pro-preview-12-2025",
    "deep-research-max-preview-04-2026",
    "deep-research-preview-04-2026",
    "nano-banana-pro-preview",
    "aqa",
    "gemini-robotics-er-1.5-preview",
    "gemma-3-1b-it",
    "gemma-3-4b-it",
    "gemma-3n-e4b-it",
    "gemma-3n-e2b-it",
    "gemma-3-12b-it",
    "gemma-3-27b-it",
  ])
  .meta({ id: "GoogleModelId" });

export const GroqModelIdSchema = z
  .enum([
    "gemma2-9b-it",
    "llama-3.1-8b-instant",
    "llama-3.3-70b-versatile",
    "meta-llama/llama-guard-4-12b",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "deepseek-r1-distill-llama-70b",
    "meta-llama/llama-4-maverick-17b-128e-instruct",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "meta-llama/llama-prompt-guard-2-22m",
    "meta-llama/llama-prompt-guard-2-86m",
    "moonshotai/kimi-k2-instruct-0905",
    "qwen/qwen3-32b",
    "llama-guard-3-8b",
    "llama3-70b-8192",
    "llama3-8b-8192",
    "mixtral-8x7b-32768",
    "qwen-qwq-32b",
    "qwen-2.5-32b",
    "deepseek-r1-distill-qwen-32b",
  ])
  .meta({ id: "GroqModelId" });

export const CerebrasModelIdSchema = z
  .enum([
    "llama3.1-8b",
    "gpt-oss-120b",
    "qwen-3-235b-a22b-instruct-2507",
    "qwen-3-235b-a22b-thinking-2507",
    "zai-glm-4.6",
    "zai-glm-4.7",
  ])
  .meta({ id: "CerebrasModelId" });

export const ModelProviderSchema = z
  .enum(["openai", "anthropic", "google", "groq", "cerebras"])
  .meta({ id: "ModelProvider" });

export const OpenAIModelNameSchema = z
  .templateLiteral(["openai/", OpenAIModelIdSchema])
  .meta({ id: "OpenAIModelName" });
export const AnthropicModelNameSchema = z
  .templateLiteral(["anthropic/", AnthropicModelIdSchema])
  .meta({ id: "AnthropicModelName" });
export const GoogleModelNameSchema = z
  .templateLiteral(["google/", GoogleModelIdSchema])
  .meta({ id: "GoogleModelName" });
export const GroqModelNameSchema = z
  .templateLiteral(["groq/", GroqModelIdSchema])
  .meta({ id: "GroqModelName" });
export const CerebrasModelNameSchema = z
  .templateLiteral(["cerebras/", CerebrasModelIdSchema])
  .meta({ id: "CerebrasModelName" });

export const ModelNameSchema = z
  .union([
    OpenAIModelNameSchema,
    AnthropicModelNameSchema,
    GoogleModelNameSchema,
    GroqModelNameSchema,
    CerebrasModelNameSchema,
  ])
  .meta({
    id: "ModelName",
    description: "An explicitly supported model name with its provider prefix",
  });

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
  .superRefine((cookie, context) => {
    let parsedUrl: URL | undefined;
    let invalidUrl = false;

    if (!cookie.url && !(cookie.domain && cookie.path)) {
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: `Cookie "${cookie.name}" must have a url or a domain/path pair`,
      });
    }

    if (cookie.url && cookie.domain) {
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: `Cookie "${cookie.name}" should have either url or domain, not both`,
      });
    }

    if (cookie.url && cookie.path) {
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: `Cookie "${cookie.name}" should have either url or path, not both`,
      });
    }

    if (cookie.expires !== undefined && cookie.expires < 0 && cookie.expires !== -1) {
      context.addIssue({
        code: "custom",
        path: ["expires"],
        message: `Cookie "${cookie.name}" has an invalid expires value; use -1 for session cookies or a positive unix timestamp`,
      });
    }

    if (cookie.url === "about:blank") {
      invalidUrl = true;
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: `Blank page cannot have cookie "${cookie.name}"`,
      });
    } else if (cookie.url?.startsWith("data:")) {
      invalidUrl = true;
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: `Data URL page cannot have cookie "${cookie.name}"`,
      });
    } else if (cookie.url) {
      try {
        parsedUrl = new URL(cookie.url);
      } catch {
        invalidUrl = true;
        context.addIssue({
          code: "custom",
          path: ["url"],
          message: `Cookie "${cookie.name}" has an invalid url: "${cookie.url}"`,
        });
      }
    }

    const effectivelySecure = cookie.url
      ? parsedUrl?.protocol === "https:"
      : cookie.secure === true;
    if (cookie.sameSite === "None" && !invalidUrl && !effectivelySecure) {
      context.addIssue({
        code: "custom",
        path: ["secure"],
        message:
          `Cookie "${cookie.name}" has sameSite: "None" without secure: true. ` +
          `Browsers require secure: true when sameSite is "None".`,
      });
    }
  })
  .meta({ id: "CookieParam" });

export const CookieRegexSchema = z
  .object({
    source: z.string(),
    flags: z
      .string()
      .regex(/^[dgimsuvy]*$/)
      .optional(),
  })
  .strict()
  .superRefine(({ source, flags }, context) => {
    try {
      new RegExp(source, flags);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Invalid cookie filter regular expression",
      });
    }
  })
  .meta({ id: "CookieRegex" });

export const CookieFilterSchema = z
  .union([z.string(), CookieRegexSchema])
  .meta({ id: "CookieFilter" });

export const ClearCookieOptionsSchema = z
  .object({
    name: CookieFilterSchema.optional(),
    domain: CookieFilterSchema.optional(),
    path: CookieFilterSchema.optional(),
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

// These schemas follow the MCP createMessage message and content shapes, with
// Stagehand's structured-output contract layered on top.
export const LLMRoleSchema = z.enum(["user", "assistant"]);

export const LLMAnnotationsSchema = z
  .object({
    audience: z.array(LLMRoleSchema).optional(),
    priority: z.number().min(0).max(1).optional(),
    lastModified: z.string().optional(),
  })
  .strict();

export const LLMTextContentSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
    annotations: LLMAnnotationsSchema.optional(),
  })
  .strict();

export const LLMImageContentSchema = z
  .object({
    type: z.literal("image"),
    data: z.base64().meta({ format: "byte" }),
    mimeType: z.string(),
    annotations: LLMAnnotationsSchema.optional(),
  })
  .strict();

export const LLMToolUseContentSchema = z
  .object({
    type: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input: z.record(z.string(), z.json()),
  })
  .strict();

const LLMToolResultContentBlockSchema = z.discriminatedUnion("type", [
  LLMTextContentSchema,
  LLMImageContentSchema,
]);

export const LLMToolResultContentSchema = z
  .object({
    type: z.literal("tool_result"),
    toolUseId: z.string(),
    content: z.array(LLMToolResultContentBlockSchema),
    structuredContent: z.record(z.string(), z.json()).optional(),
    isError: z.boolean().optional(),
  })
  .strict();

export const LLMMessageContentBlockSchema = z.discriminatedUnion("type", [
  LLMTextContentSchema,
  LLMImageContentSchema,
  LLMToolUseContentSchema,
  LLMToolResultContentSchema,
]);

export const LLMMessageSchema = z
  .object({
    role: LLMRoleSchema,
    content: z.union([LLMMessageContentBlockSchema, z.array(LLMMessageContentBlockSchema)]),
  })
  .strict();

export const LLMToolAnnotationsSchema = z
  .object({
    title: z.string().optional(),
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional(),
  })
  .strict();

export const LLMToolExecutionSchema = z
  .object({
    taskSupport: z.enum(["forbidden", "optional", "required"]).optional(),
  })
  .strict();

export const LLMToolIconSchema = z
  .object({
    src: z.url(),
    mimeType: z.string().optional(),
    sizes: z.array(z.string()).optional(),
    theme: z.enum(["light", "dark"]).optional(),
  })
  .strict();

const LLMToolJsonSchema = z
  .object({
    $schema: z.string().optional(),
    type: z.literal("object"),
    properties: z.record(z.string(), z.record(z.string(), z.json())).optional(),
    required: z.array(z.string()).optional(),
  })
  .strict();

export const LLMClientToolSchema = z
  .object({
    name: z.string(),
    title: z.string().optional(),
    icons: z.array(LLMToolIconSchema).optional(),
    description: z.string().optional(),
    inputSchema: LLMToolJsonSchema,
    execution: LLMToolExecutionSchema.optional(),
    outputSchema: LLMToolJsonSchema.optional(),
    annotations: LLMToolAnnotationsSchema.optional(),
  })
  .strict();

export const LLMToolChoiceSchema = z
  .object({
    mode: z.enum(["auto", "required", "none"]).optional(),
  })
  .strict();

export const LLMTextResponseFormatSchema = z
  .object({
    type: z.literal("text"),
  })
  .strict();

export const LLMJsonSchemaResponseFormatSchema = z
  .object({
    type: z.literal("json_schema"),
    name: z.string(),
    description: z.string().optional(),
    schema: z.json(),
  })
  .strict();

export const LLMResponseFormatSchema = z.discriminatedUnion("type", [
  LLMTextResponseFormatSchema,
  LLMJsonSchemaResponseFormatSchema,
]);

const LLMGenerateBaseParamsSchema = z
  .object({
    messages: z.array(LLMMessageSchema),
    systemPrompt: z.string().optional(),
    temperature: z.number().optional(),
    stopSequences: z.array(z.string()).optional(),
  })
  .strict();

export const LLMMessageGenerateParamsSchema = LLMGenerateBaseParamsSchema.extend({
  tools: z.array(LLMClientToolSchema).optional(),
  toolChoice: LLMToolChoiceSchema.optional(),
  responseFormat: LLMTextResponseFormatSchema.optional(),
}).strict();

export const LLMStructuredGenerateParamsSchema = LLMGenerateBaseParamsSchema.extend({
  responseFormat: LLMJsonSchemaResponseFormatSchema,
}).strict();

export const LLMGenerateParamsSchema = z.union([
  LLMStructuredGenerateParamsSchema,
  LLMMessageGenerateParamsSchema,
]);

export const LLMUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative().optional(),
    cachedInputTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

const LLMGenerateBaseResultSchema = z
  .object({
    role: LLMRoleSchema,
    content: z.union([LLMMessageContentBlockSchema, z.array(LLMMessageContentBlockSchema)]),
    stopReason: z.string().optional(),
    usage: LLMUsageSchema.optional(),
  })
  .catchall(z.json());

export const LLMMessageGenerateResultSchema = LLMGenerateBaseResultSchema.extend({
  outputFormat: z.literal("text"),
});

export const LLMStructuredGenerateResultSchema = LLMGenerateBaseResultSchema.extend({
  outputFormat: z.literal("json_schema"),
  structuredContent: z.json(),
});

export const LLMGenerateResultSchema = z.discriminatedUnion("outputFormat", [
  LLMMessageGenerateResultSchema,
  LLMStructuredGenerateResultSchema,
]);

/**
 * Builds the result validator for a particular llm.generate request.
 *
 * Prefer the original in-memory Zod schema. When only the wire JSON Schema is
 * available, Zod can recreate an equivalent validator.
 */
export function createLLMGenerateResultSchema(
  params: z.output<typeof LLMGenerateParamsSchema>,
  originalStructuredContentSchema?: z.ZodType,
) {
  if (params.responseFormat?.type !== "json_schema") {
    return LLMMessageGenerateResultSchema;
  }

  const structuredContentSchema =
    originalStructuredContentSchema ??
    z.fromJSONSchema(params.responseFormat.schema as Parameters<typeof z.fromJSONSchema>[0]);

  return LLMGenerateBaseResultSchema.extend({
    outputFormat: z.literal("json_schema"),
    structuredContent: structuredContentSchema,
  });
}

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

const ModelConnectionSchema = z
  .object({
    apiKey: z.string().min(1).optional().meta({
      description: "API key for the model provider",
      example: "sk-some-openai-api-key",
    }),
    headers: z.record(z.string(), z.string()).optional().meta({
      description: "Custom headers sent with every request to the model provider",
    }),
  })
  .strict();

export const KnownModelConfigSchema = ModelConnectionSchema.extend({
  modelName: ModelNameSchema.meta({
    description: "An explicitly supported model name with its provider prefix",
    example: "openai/gpt-5.4-mini",
  }),
})
  .strict()
  .meta({ id: "KnownModelConfig" });

export const CustomModelConfigSchema = ModelConnectionSchema.extend({
  modelName: z.string().min(1).meta({
    description: "Model name accepted by the custom OpenAI-compatible endpoint",
    example: "private/model-v2",
  }),
  baseURL: z.url().meta({
    description: "Base URL for the custom OpenAI-compatible endpoint",
    example: "https://models.example.com/v1",
  }),
})
  .strict()
  .meta({ id: "CustomModelConfig" });

export const ModelConfigSchema = z
  .union([KnownModelConfigSchema, CustomModelConfigSchema])
  .meta({ id: "ModelConfig" });

/** Serializable reference to an LLM implemented by the connected Stagehand client. */
export const ClientModelReferenceSchema = z
  .object({
    source: z.literal("client"),
  })
  .strict()
  .meta({ id: "ClientModelReference" });

/** Browserbase viewport configuration. */
export const BrowserbaseViewportSchema = z
  .object({
    width: z.number().optional(),
    height: z.number().optional(),
  })
  .meta({ id: "BrowserbaseViewport" });

/** Browserbase fingerprint screen configuration. */
export const BrowserbaseFingerprintScreenSchema = z
  .object({
    maxHeight: z.number().optional(),
    maxWidth: z.number().optional(),
    minHeight: z.number().optional(),
    minWidth: z.number().optional(),
  })
  .meta({ id: "BrowserbaseFingerprintScreen" });

/** Browserbase fingerprint configuration for stealth mode. */
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

/** Browserbase context configuration for session persistence. */
export const BrowserbaseContextSchema = z
  .object({
    id: z.string(),
    persist: z.boolean().optional(),
  })
  .meta({ id: "BrowserbaseContext" });

/** Browserbase browser settings for session creation. */
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

/** Browserbase managed proxy geolocation configuration. */
export const BrowserbaseProxyGeolocationSchema = z
  .object({
    country: z.string(),
    city: z.string().optional(),
    state: z.string().optional(),
  })
  .meta({ id: "BrowserbaseProxyGeolocation" });

/** Browserbase managed proxy configuration. */
export const BrowserbaseProxyConfigSchema = z
  .object({
    type: z.literal("browserbase"),
    domainPattern: z.string().optional(),
    geolocation: BrowserbaseProxyGeolocationSchema.optional(),
  })
  .meta({ id: "BrowserbaseProxyConfig" });

/** External proxy configuration. */
export const ExternalProxyConfigSchema = z
  .object({
    type: z.literal("external"),
    server: z.string(),
    domainPattern: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
  })
  .meta({ id: "ExternalProxyConfig" });

/** Browserbase session proxy configuration. */
export const ProxyConfigSchema = z
  .discriminatedUnion("type", [BrowserbaseProxyConfigSchema, ExternalProxyConfigSchema])
  .meta({ id: "ProxyConfig" });

/** Browserbase region identifier for multi-region support. */
export const BrowserbaseRegionSchema = z
  .enum(["us-west-2", "us-east-1", "eu-central-1", "ap-southeast-1"])
  .meta({ id: "BrowserbaseRegion" });

/** Browserbase session creation parameters. */
export const BrowserbaseSessionCreateParamsSchema = z
  .object({
    browserSettings: BrowserbaseBrowserSettingsSchema.optional(),
    extensionId: z.string().optional(),
    keepAlive: z.boolean().optional(),
    proxies: z.union([z.boolean(), z.array(ProxyConfigSchema)]).optional(),
    region: BrowserbaseRegionSchema.optional(),
    timeout: z.number().optional(),
    userMetadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .meta({ id: "BrowserbaseSessionCreateParams" });

/** Browserbase configuration available to both the SDK and the service worker. */
export const BrowserbaseBrowserSourceSchema = BrowserbaseSessionCreateParamsSchema.extend({
  type: z.literal("browserbase"),
})
  .strict()
  .meta({ id: "BrowserbaseBrowserSource" });

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
      description:
        "Complete model configuration for this call; when omitted, the initialized Stagehand model is used",
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
      description:
        "Complete model configuration for this call; when omitted, the initialized Stagehand model is used",
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
      description:
        "Complete model configuration for this call; when omitted, the initialized Stagehand model is used",
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

export const LoadStateSchema = z
  .enum(["load", "domcontentloaded", "networkidle"])
  .meta({ id: "LoadState" });

export const PageNavigationOptionsSchema = z
  .object({
    waitUntil: LoadStateSchema.optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict()
  .meta({ id: "PageNavigationOptions" });

export const PageVoidResultSchema = z
  .object({
    ok: z.literal(true),
  })
  .strict()
  .meta({ id: "PageVoidResult" });

export const ContextVoidResultSchema = z
  .object({
    ok: z.literal(true),
  })
  .strict()
  .meta({ id: "ContextVoidResult" });

export const ContextCloseResultSchema = z
  .object({
    closed: z.literal(true),
  })
  .strict()
  .meta({ id: "ContextCloseResult" });

export const PageCoordinateResultSchema = z
  .object({
    xpath: z.string(),
  })
  .strict()
  .meta({ id: "PageCoordinateResult" });

export const PageScreenshotClipSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict()
  .meta({ id: "PageScreenshotClip" });

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
    nth: z.number().int().nonnegative().optional(),
  })
  .strict();

export const TelemetryConfigSchema = z
  .strictObject({
    traces: z.strictObject({
      endpoint: z.url().refine((value) => new URL(value).pathname.endsWith("/v1/traces"), {
        message: "OTLP trace endpoint must end with /v1/traces",
      }),
      headers: z.record(z.string(), z.string()).default({}),
    }),
  })
  .default({
    traces: {
      endpoint: "https://example.com/v1/traces", // TODO: Replace with the Browserbase OTLP traces ingestion endpoint.
      headers: {},
    },
  })
  .meta({ id: "TelemetryConfig" });

export const StagehandInitParamsSchema = z
  .object({
    apiKey: z.string().min(1).optional(),
    browser: BrowserbaseBrowserSourceSchema.optional(),
    model: z.union([ModelConfigSchema, ClientModelReferenceSchema]).optional(),
    telemetry: TelemetryConfigSchema,
    sessionId: z.string().optional(),
    systemPrompt: z.string().optional(),
    logInferenceToFile: z.boolean().optional(),
    experimental: z.boolean().optional(),
    selfHeal: z.boolean().optional(),
    domSettleTimeoutMs: z.number().int().positive().optional(),
  })
  .strict()
  .meta({ id: "StagehandInitParams" });

export const RuntimeConfigureParamsSchema = z
  .object({
    cdpUrl: z.string().min(1),
    telemetry: TelemetryConfigSchema,
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
    pageId: z.string().min(1),
    instruction: z.string().optional(),
    options: ObserveOptionsSchema,
  })
  .strict();

export const StagehandExtractParamsSchema = z
  .object({
    pageId: z.string().min(1),
    instruction: z.string().min(1),
    schema: z.json(),
    options: ExtractOptionsSchema,
  })
  .strict();

export const ContextNewPageParamsSchema = z
  .object({
    url: z.string().optional(),
  })
  .strict();

export const ContextSetActivePageParamsSchema = z
  .object({
    pageId: z.string(),
  })
  .strict();

export const ContextAddInitScriptParamsSchema = z
  .object({
    source: z.string(),
  })
  .strict();

export const ContextSetExtraHTTPHeadersParamsSchema = z
  .object({
    headers: z.record(z.string(), z.string()),
  })
  .strict();

export const ContextSetDomainPolicyParamsSchema = z
  .object({
    policy: DomainPolicySchema.nullable(),
  })
  .strict();

export const ContextCookiesParamsSchema = z
  .object({
    urls: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .strict();

export const ContextAddCookiesParamsSchema = z
  .object({
    cookies: z.array(CookieParamSchema),
  })
  .strict();

export const ContextClearCookiesParamsSchema = z
  .object({
    options: ClearCookieOptionsSchema.optional(),
  })
  .strict();

export const ContextClipboardTargetSchema = z
  .object({
    pageId: z.string().optional(),
  })
  .strict()
  .meta({ id: "ContextClipboardTarget" });

export const ContextClipboardReadTextParamsSchema = ContextClipboardTargetSchema;

export const ContextClipboardWriteTextParamsSchema = ContextClipboardTargetSchema.extend({
  text: z.string(),
}).strict();

export const ContextClipboardClearParamsSchema = ContextClipboardTargetSchema;

export const ContextClipboardPasteParamsSchema = ContextClipboardTargetSchema.extend({
  shortcut: z.enum(["ControlOrMeta+V", "Meta+V", "Control+V"]).optional(),
}).strict();

export const ContextClipboardCopyParamsSchema = ContextClipboardTargetSchema;

export const ContextClipboardCutParamsSchema = ContextClipboardTargetSchema;

export const PageGotoParamsSchema = z
  .object({
    pageId: z.string(),
    url: z.string().min(1),
    options: PageNavigationOptionsSchema.optional(),
  })
  .strict();

export const PageIdParamsSchema = z
  .object({
    pageId: z.string(),
  })
  .strict();

export const MouseButtonSchema = z.enum(["left", "right", "middle"]);

export const PageReloadParamsSchema = PageIdParamsSchema.extend({
  options: PageNavigationOptionsSchema.extend({
    ignoreCache: z.boolean().optional(),
  })
    .strict()
    .optional(),
}).strict();

export const PageGoBackParamsSchema = PageIdParamsSchema.extend({
  options: PageNavigationOptionsSchema.optional(),
}).strict();

export const PageGoForwardParamsSchema = PageIdParamsSchema.extend({
  options: PageNavigationOptionsSchema.optional(),
}).strict();

export const PageClickParamsSchema = PageIdParamsSchema.extend({
  x: z.number(),
  y: z.number(),
  options: z
    .object({
      button: MouseButtonSchema.optional(),
      clickCount: z.number().int().positive().optional(),
      returnXpath: z.boolean().optional(),
    })
    .strict()
    .optional(),
}).strict();

export const PageHoverParamsSchema = PageIdParamsSchema.extend({
  x: z.number(),
  y: z.number(),
  options: z
    .object({
      returnXpath: z.boolean().optional(),
    })
    .strict()
    .optional(),
}).strict();

export const PageScrollParamsSchema = PageIdParamsSchema.extend({
  x: z.number(),
  y: z.number(),
  deltaX: z.number(),
  deltaY: z.number(),
  options: z
    .object({
      returnXpath: z.boolean().optional(),
    })
    .strict()
    .optional(),
}).strict();

export const PageDragAndDropParamsSchema = PageIdParamsSchema.extend({
  fromX: z.number(),
  fromY: z.number(),
  toX: z.number(),
  toY: z.number(),
  options: z
    .object({
      button: MouseButtonSchema.optional(),
      steps: z.number().int().positive().optional(),
      delay: z.number().nonnegative().optional(),
      returnXpath: z.boolean().optional(),
    })
    .strict()
    .optional(),
}).strict();

export const PageTypeParamsSchema = PageIdParamsSchema.extend({
  text: z.string(),
  options: z
    .object({
      delay: z.number().nonnegative().optional(),
      withMistakes: z.boolean().optional(),
    })
    .strict()
    .optional(),
}).strict();

export const PageKeyPressParamsSchema = PageIdParamsSchema.extend({
  key: z.string().min(1),
  options: z
    .object({
      delay: z.number().nonnegative().optional(),
    })
    .strict()
    .optional(),
}).strict();

export const PageEvaluateParamsSchema = PageIdParamsSchema.extend({
  expression: z.string(),
}).strict();

export const PageAddInitScriptParamsSchema = PageIdParamsSchema.extend({
  source: z.string(),
}).strict();

export const PageSetExtraHTTPHeadersParamsSchema = PageIdParamsSchema.extend({
  headers: z.record(z.string(), z.string()),
}).strict();

export const PageScreenshotOptionsSchema = z
  .object({
    animations: z.enum(["disabled", "allow"]).optional(),
    caret: z.enum(["hide", "initial"]).optional(),
    clip: PageScreenshotClipSchema.optional(),
    fullPage: z.boolean().optional(),
    mask: z.array(LocatorDescriptorSchema).optional(),
    maskColor: z.string().optional(),
    omitBackground: z.boolean().optional(),
    quality: z.number().int().min(0).max(100).optional(),
    scale: z.enum(["css", "device"]).optional(),
    style: z.string().optional(),
    timeout: z.number().nonnegative().optional(),
    type: z.enum(["png", "jpeg"]).optional(),
  })
  .strict()
  .refine((options) => !(options.fullPage && options.clip), {
    message: "fullPage and clip cannot be used together",
    path: ["clip"],
  })
  .refine((options) => options.type === "jpeg" || options.quality === undefined, {
    message: 'quality is only valid when type is "jpeg"',
    path: ["quality"],
  })
  .meta({ id: "PageScreenshotOptions" });

export const PageScreenshotParamsSchema = PageIdParamsSchema.extend({
  options: PageScreenshotOptionsSchema.optional(),
}).strict();

export const PageSnapshotParamsSchema = PageIdParamsSchema.extend({
  options: PageSnapshotOptionsSchema.optional(),
}).strict();

export const PageSetViewportSizeParamsSchema = PageIdParamsSchema.extend({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  options: z
    .object({
      deviceScaleFactor: z.number().positive().optional(),
    })
    .strict()
    .optional(),
}).strict();

export const PageWaitForLoadStateParamsSchema = PageIdParamsSchema.extend({
  state: LoadStateSchema,
  timeoutMs: z.number().int().nonnegative().optional(),
}).strict();

export const PageWaitForTimeoutParamsSchema = PageIdParamsSchema.extend({
  ms: z.number().int().nonnegative(),
}).strict();

export const PageWaitForSelectorParamsSchema = PageIdParamsSchema.extend({
  selector: z.string().min(1),
  options: z
    .object({
      state: z.enum(["attached", "detached", "visible", "hidden"]).optional(),
      timeout: z.number().int().nonnegative().optional(),
      pierceShadow: z.boolean().optional(),
    })
    .strict()
    .optional(),
}).strict();

export const LocatorClickParamsSchema = LocatorDescriptorSchema.extend({
  options: z
    .object({
      button: MouseButtonSchema.optional(),
      clickCount: z.number().int().positive().optional(),
    })
    .strict()
    .optional(),
}).strict();

export const LocatorFillParamsSchema = LocatorDescriptorSchema.extend({
  value: z.string(),
}).strict();

export const LocatorScrollToParamsSchema = LocatorDescriptorSchema.extend({
  percent: z.union([z.number(), z.string()]),
}).strict();

export const RgbaColorSchema = z
  .object({
    r: z.number(),
    g: z.number(),
    b: z.number(),
    a: z.number().optional(),
  })
  .strict();

export const LocatorHighlightParamsSchema = LocatorDescriptorSchema.extend({
  options: z
    .object({
      durationMs: z.number().int().nonnegative().optional(),
      borderColor: RgbaColorSchema.optional(),
      contentColor: RgbaColorSchema.optional(),
    })
    .strict()
    .optional(),
}).strict();

export const LocatorSendClickEventParamsSchema = LocatorDescriptorSchema.extend({
  options: z
    .object({
      bubbles: z.boolean().optional(),
      cancelable: z.boolean().optional(),
      composed: z.boolean().optional(),
      detail: z.number().optional(),
    })
    .strict()
    .optional(),
}).strict();

export const LocatorTypeParamsSchema = LocatorDescriptorSchema.extend({
  text: z.string(),
  options: z
    .object({
      delay: z.number().nonnegative().optional(),
    })
    .strict()
    .optional(),
}).strict();

export const LocatorSelectOptionParamsSchema = LocatorDescriptorSchema.extend({
  values: z.union([z.string(), z.array(z.string())]),
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

export const ContextActivePageResultSchema = PageRefSchema.nullable().meta({
  id: "ContextActivePageResult",
});

export const ContextGetDomainPolicyResultSchema = z
  .object({
    policy: DomainPolicySchema.nullable(),
  })
  .strict()
  .meta({ id: "ContextGetDomainPolicyResult" });

export const ContextCookiesResultSchema = z
  .object({
    cookies: z.array(CookieSchema),
  })
  .strict()
  .meta({ id: "ContextCookiesResult" });

export const ContextClipboardReadTextResultSchema = z
  .object({
    text: z.string(),
  })
  .strict()
  .meta({ id: "ContextClipboardReadTextResult" });

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

export const PageDragAndDropResultSchema = z
  .object({
    fromXpath: z.string(),
    toXpath: z.string(),
  })
  .strict();

export const PageEvaluateResultSchema = z
  .object({
    value: z.json(),
  })
  .strict();

export const PageScreenshotResultSchema = z
  .object({
    data: z.base64().meta({ format: "byte" }),
    type: z.enum(["png", "jpeg"]),
  })
  .strict();

export const PageWaitForSelectorResultSchema = z
  .object({
    matched: z.boolean(),
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

export const LocatorHoverResultSchema = z
  .object({
    hovered: z.literal(true),
  })
  .strict();

export const LocatorCountResultSchema = z
  .object({
    count: z.number().int().nonnegative(),
  })
  .strict();

export const LocatorIsCheckedResultSchema = z
  .object({
    checked: z.boolean(),
  })
  .strict();

export const LocatorInputValueResultSchema = z
  .object({
    value: z.string(),
  })
  .strict();

export const LocatorIsVisibleResultSchema = z
  .object({
    visible: z.boolean(),
  })
  .strict();

export const LocatorInnerTextResultSchema = z
  .object({
    text: z.string(),
  })
  .strict();

export const LocatorInnerHtmlResultSchema = z
  .object({
    html: z.string(),
  })
  .strict();

export const LocatorTextContentResultSchema = z
  .object({
    textContent: z.string(),
  })
  .strict();

export const LocatorScrollToResultSchema = z
  .object({
    scrolled: z.literal(true),
  })
  .strict();

export const LocatorCentroidResultSchema = z
  .object({
    x: z.number(),
    y: z.number(),
  })
  .strict();

export const LocatorHighlightResultSchema = z
  .object({
    highlighted: z.literal(true),
  })
  .strict();

export const LocatorSendClickEventResultSchema = z
  .object({
    clicked: z.literal(true),
  })
  .strict();

export const LocatorTypeResultSchema = z
  .object({
    typed: z.literal(true),
  })
  .strict();

export const LocatorSelectOptionResultSchema = z
  .object({
    values: z.array(z.string()),
  })
  .strict();

export const StagehandLogLevelSchema = z.enum(["debug", "info", "warn", "error"]);

export const StagehandLogDataSchema = z.record(z.string(), z.json());

export const StagehandLogSchema = z.strictObject({
  level: StagehandLogLevelSchema,
  message: z.string().min(1),
  data: StagehandLogDataSchema,
});
