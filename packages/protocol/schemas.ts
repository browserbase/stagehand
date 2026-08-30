import { z } from "zod/v4";
import { StagehandProtocolVersionSchema } from "./protocol-version.ts";

export { STAGEHAND_PROTOCOL_VERSION } from "./protocol-version.ts";

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
    "gemini-3.6-flash",
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
  .strictObject({
    name: z.string(),
    value: z.string(),
    domain: z.string(),
    path: z.string(),
    expires: z.number(),
    httpOnly: z.boolean(),
    secure: z.boolean(),
    sameSite: z.enum(["Strict", "Lax", "None"]),
  })
  .meta({ id: "Cookie" });

export const CookieParamSchema = z
  .strictObject({
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
  .strictObject({
    source: z.string(),
    flags: z
      .string()
      .regex(/^[dgimsuvy]*$/)
      .optional(),
  })
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
  .strictObject({
    name: CookieFilterSchema.optional(),
    domain: CookieFilterSchema.optional(),
    path: CookieFilterSchema.optional(),
  })
  .meta({ id: "ClearCookieOptions" });

export const DomainPolicySchema = z
  .strictObject({
    allowedDomains: z.array(z.string()).optional(),
    blockedDomains: z.array(z.string()).optional(),
  })
  .meta({ id: "DomainPolicy" });

// These schemas follow the MCP createMessage message and content shapes, with
// Stagehand's structured-output contract layered on top.
export const LLMRoleSchema = z.enum(["user", "assistant"]).meta({ id: "LLMRole" });

export const LLMAnnotationsSchema = z
  .strictObject({
    audience: z.array(LLMRoleSchema).optional(),
    priority: z.number().min(0).max(1).optional(),
    lastModified: z.string().optional(),
  })
  .meta({ id: "LLMAnnotations" });

export const LLMTextContentSchema = z
  .strictObject({
    type: z.literal("text"),
    text: z.string(),
    annotations: LLMAnnotationsSchema.optional(),
  })
  .meta({ id: "LLMTextContent" });

export const LLMImageContentSchema = z
  .strictObject({
    type: z.literal("image"),
    data: z.base64().meta({ format: "byte" }),
    mimeType: z.string(),
    annotations: LLMAnnotationsSchema.optional(),
  })
  .meta({ id: "LLMImageContent" });

export const LLMToolUseContentSchema = z
  .strictObject({
    type: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input: z.record(z.string(), z.json()),
  })
  .meta({ id: "LLMToolUseContent" });

const LLMToolResultContentBlockSchema = z
  .discriminatedUnion("type", [LLMTextContentSchema, LLMImageContentSchema])
  .meta({ id: "LLMToolResultContentBlock" });

export const LLMToolResultContentSchema = z
  .strictObject({
    type: z.literal("tool_result"),
    toolUseId: z.string(),
    content: z.array(LLMToolResultContentBlockSchema),
    structuredContent: z.record(z.string(), z.json()).optional(),
    isError: z.boolean().optional(),
  })
  .meta({ id: "LLMToolResultContent" });

export const LLMMessageContentBlockSchema = z
  .discriminatedUnion("type", [
    LLMTextContentSchema,
    LLMImageContentSchema,
    LLMToolUseContentSchema,
    LLMToolResultContentSchema,
  ])
  .meta({ id: "LLMMessageContentBlock" });

export const LLMMessageSchema = z
  .strictObject({
    role: LLMRoleSchema,
    content: z.union([LLMMessageContentBlockSchema, z.array(LLMMessageContentBlockSchema)]),
  })
  .meta({ id: "LLMMessage" });

export const LLMToolAnnotationsSchema = z
  .strictObject({
    title: z.string().optional(),
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional(),
  })
  .meta({ id: "LLMToolAnnotations" });

export const LLMToolExecutionSchema = z
  .strictObject({
    taskSupport: z.enum(["forbidden", "optional", "required"]).optional(),
  })
  .meta({ id: "LLMToolExecution" });

export const LLMToolIconSchema = z
  .strictObject({
    src: z.url(),
    mimeType: z.string().optional(),
    sizes: z.array(z.string()).optional(),
    theme: z.enum(["light", "dark"]).optional(),
  })
  .meta({ id: "LLMToolIcon" });

const LLMToolJsonSchema = z
  .strictObject({
    $schema: z.string().optional(),
    type: z.literal("object"),
    properties: z.record(z.string(), z.record(z.string(), z.json())).optional(),
    required: z.array(z.string()).optional(),
  })
  .meta({ id: "LLMToolJson" });

export const LLMToolSchema = z
  .strictObject({
    type: z.literal("function"),
    name: z.string(),
    description: z.string(),
    parameters: z.record(z.string(), z.unknown()),
  })
  .required()
  .meta({ id: "LLMTool" });

export const LLMClientToolSchema = z
  .strictObject({
    name: z.string(),
    title: z.string().optional(),
    icons: z.array(LLMToolIconSchema).optional(),
    description: z.string().optional(),
    inputSchema: LLMToolJsonSchema,
    execution: LLMToolExecutionSchema.optional(),
    outputSchema: LLMToolJsonSchema.optional(),
    annotations: LLMToolAnnotationsSchema.optional(),
  })
  .meta({ id: "LLMClientTool" });

export const LLMToolChoiceSchema = z
  .strictObject({
    mode: z.enum(["auto", "required", "none"]).optional(),
  })
  .meta({ id: "LLMToolChoice" });

export const LLMTextResponseFormatSchema = z
  .strictObject({
    type: z.literal("text"),
  })
  .meta({ id: "LLMTextResponseFormat" });

export const LLMJsonSchemaResponseFormatSchema = z
  .strictObject({
    type: z.literal("json_schema"),
    name: z.string(),
    description: z.string().optional(),
    schema: z.json(),
  })
  .meta({ id: "LLMJsonSchemaResponseFormat" });

export const LLMResponseFormatSchema = z
  .discriminatedUnion("type", [LLMTextResponseFormatSchema, LLMJsonSchemaResponseFormatSchema])
  .meta({ id: "LLMResponseFormat" });

const LLMGenerateBaseParamsSchema = z
  .strictObject({
    messages: z.array(LLMMessageSchema),
    systemPrompt: z.string().optional(),
    temperature: z.number().optional(),
    stopSequences: z.array(z.string()).optional(),
  })
  .meta({ id: "LLMGenerateBaseParams" });

export const LLMMessageGenerateParamsSchema = LLMGenerateBaseParamsSchema.extend({
  tools: z.array(LLMClientToolSchema).optional(),
  toolChoice: LLMToolChoiceSchema.optional(),
  responseFormat: LLMTextResponseFormatSchema.optional(),
}).meta({ id: "LLMMessageGenerateParams" });

export const LLMStructuredGenerateParamsSchema = LLMGenerateBaseParamsSchema.extend({
  responseFormat: LLMJsonSchemaResponseFormatSchema,
}).meta({ id: "LLMStructuredGenerateParams" });

export const LLMGenerateParamsSchema = z
  .union([LLMStructuredGenerateParamsSchema, LLMMessageGenerateParamsSchema])
  .meta({ id: "LLMGenerateParams" });

export const LLMUsageSchema = z
  .strictObject({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative().optional(),
    cachedInputTokens: z.number().int().nonnegative().optional(),
  })
  .meta({ id: "LLMUsage" });

const LLMGenerateBaseResultSchema = z
  .strictObject({
    role: LLMRoleSchema,
    content: z.union([LLMMessageContentBlockSchema, z.array(LLMMessageContentBlockSchema)]),
    stopReason: z.string().optional(),
    usage: LLMUsageSchema.optional(),
  })
  .meta({ id: "LLMGenerateBaseResult" });

export const LLMMessageGenerateResultSchema = LLMGenerateBaseResultSchema.extend({
  outputFormat: z.literal("text"),
}).meta({ id: "LLMMessageGenerateResult" });

export const LLMStructuredGenerateResultSchema = LLMGenerateBaseResultSchema.extend({
  outputFormat: z.literal("json_schema"),
  structuredContent: z.json(),
}).meta({ id: "LLMStructuredGenerateResult" });

export const LLMGenerateResultSchema = z
  .discriminatedUnion("outputFormat", [
    LLMMessageGenerateResultSchema,
    LLMStructuredGenerateResultSchema,
  ])
  .meta({ id: "LLMGenerateResult" });

/**
 * Builds the result validator for a particular llm.generate request.
 *
 * Prefer an original in-memory Zod schema when one exists. Foreign wire JSON
 * Schema validation belongs to the extension's hardened interpreter boundary.
 */
export function createLLMGenerateResultSchema(
  params: z.output<typeof LLMGenerateParamsSchema>,
  originalStructuredContentSchema?: z.ZodType,
) {
  if (params.responseFormat?.type !== "json_schema") {
    return LLMMessageGenerateResultSchema;
  }

  const structuredContentSchema = originalStructuredContentSchema ?? z.json();

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
      .strictObject({
        value: VariablePrimitiveSchema,
        description: z.string().optional(),
      })
      .meta({ id: "DescribedVariableValue" }),
  ])
  .meta({ id: "VariableValue" });

export const VariablesSchema = z.record(z.string(), VariableValueSchema).meta({ id: "Variables" });

export const PageLocatorSchema = z
  .strictObject({
    pageIdx: z.number().int().nonnegative().nullable().optional(),
    url: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    active: z.boolean().nullable().optional(),
    targetId: z.string().nullable().optional(),
    tabId: z.number().int().nonnegative().nullable().optional(),
    frameId: z.string().nullable().optional(),
  })
  .meta({ id: "PageLocator" });

export const LocatorSchema = z
  .strictObject({
    selector: z.string().min(1),
    nth: z.number().int().nonnegative().optional(),
  })
  .meta({ id: "Locator" });

export const StagehandMetricsSchema = z
  .strictObject({
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
  .meta({ id: "StagehandMetrics" });

// Chromium clamps timer delays to a signed 32-bit integer. Reserve the SDK's
// 10-second RPC response grace period so both timers remain within that limit.
export const MAX_CALLBACK_BATCH_TIMEOUT_MS = 2_147_483_647 - 10_000;

export const CallbackBatchOptionsSchema = z
  .strictObject({
    pageId: z.string().min(1).optional(),
    timeout: z.number().int().positive().max(MAX_CALLBACK_BATCH_TIMEOUT_MS).default(30_000),
  })
  .meta({ id: "CallbackBatchOptions" });

export const CallbackBatchParamsSchema = z
  .strictObject({
    callbackSource: z.string().min(1),
    input: z.json().optional(),
    options: CallbackBatchOptionsSchema,
  })
  .meta({ id: "CallbackBatchParams" });

export const CallbackBatchResultSchema = z
  .strictObject({
    value: z.json().optional(),
  })
  .meta({ id: "CallbackBatchResult" });

export const CacheStatusSchema = z.enum(["HIT", "MISS", "DISABLED"]).meta({ id: "CacheStatus" });

/** Server-side caching configuration: a boolean toggle, or an object enabling
 * caching with an optional hit-count threshold (how many identical results
 * must be seen before the cache serves a hit; overrides the project's
 * configured threshold). */
export const CachingSchema = z
  .union([
    z.boolean(),
    z.strictObject({
      threshold: z.number().int().positive().optional(),
    }),
  ])
  .meta({ id: "Caching" });

export const ApiKeyAuthSchema = z
  .strictObject({
    type: z.literal("apiKey"),
    apiKey: z.string().min(1),
  })
  .meta({ id: "ApiKeyAuth" });

/** Detailed model configuration object */
export const GoogleServiceAccountCredentialsSchema = z
  .strictObject({
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
  .meta({ id: "GoogleServiceAccountCredentials" });

export const GoogleServiceAccountAuthSchema = z
  .strictObject({
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
  .meta({ id: "GoogleServiceAccountAuth" });

export const AzureEntraIdAuthSchema = z
  .strictObject({
    type: z.literal("azureEntraId").meta({
      description: "Use a Microsoft Entra ID bearer token for authentication",
    }),
    token: z.string().min(1).meta({
      description: "Microsoft Entra ID bearer token for Azure OpenAI",
    }),
  })
  .meta({ id: "AzureEntraIdAuth" });

export const VertexProviderOptionsSchema = z
  .strictObject({
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
  .meta({ id: "VertexProviderOptions" });

export const AzureProviderOptionsSchema = z
  .strictObject({
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
  .meta({ id: "AzureProviderOptions" });

export const VertexModelProviderOptionsSchema = z
  .strictObject({
    type: z.literal("vertex"),
    options: VertexProviderOptionsSchema.meta({
      description: "Vertex AI provider-specific settings",
    }),
  })
  .meta({ id: "VertexModelProviderOptions" });

export const AzureModelProviderOptionsSchema = z
  .strictObject({
    type: z.literal("azure"),
    options: AzureProviderOptionsSchema.meta({
      description: "Azure OpenAI provider-specific settings",
    }),
  })
  .meta({ id: "AzureModelProviderOptions" });

export const ThinkingEffortSchema = z
  .enum(["none", "low", "medium", "high", "xhigh", "max"])
  .meta({ id: "ThinkingEffort" });

export const ModelAuthSchema = z
  .discriminatedUnion("type", [
    ApiKeyAuthSchema,
    GoogleServiceAccountAuthSchema,
    AzureEntraIdAuthSchema,
  ])
  .meta({ id: "ModelAuth" });

export const ModelProviderOptionsSchema = z
  .discriminatedUnion("type", [VertexModelProviderOptionsSchema, AzureModelProviderOptionsSchema])
  .meta({ id: "ModelProviderOptions" });

export const ClientOptionsBaseSchema = z
  .strictObject({
    provider: ModelProviderSchema.optional(),
    auth: ModelAuthSchema.optional(),
    providerOptions: ModelProviderOptionsSchema.optional(),
    baseURL: z.string().optional(),
    organization: z.string().optional(),
    thinkingBudget: z.number().optional(),
    thinkingEffort: ThinkingEffortSchema.optional(),
    headers: z.record(z.string(), z.string()).optional(),
    reasoningEffort: z.string().optional(),
  })
  .meta({ id: "ClientOptionsBase" });

export const ClientOptionsSchema = ClientOptionsBaseSchema.default({}).meta({
  id: "ClientOptions",
});

const ModelConnectionSchema = z
  .strictObject({
    apiKey: z.string().min(1).optional().meta({
      description: "API key for the model provider",
      example: "sk-some-openai-api-key",
    }),
    headers: z.record(z.string(), z.string()).optional().meta({
      description: "Custom headers sent with every request to the model provider",
    }),
  })
  .meta({ id: "ModelConnection" });

export const ModelConfigSchema = ModelConnectionSchema.extend({
  modelName: ModelNameSchema.meta({
    description: "An explicitly supported model name with its provider prefix",
    example: "openai/gpt-5.4-mini",
  }),
}).meta({ id: "ModelConfig" });

/** Serializable reference to an LLM implemented by the connected Stagehand client. */
export const ClientModelReferenceSchema = z
  .strictObject({
    source: z.literal("client"),
  })
  .meta({ id: "ClientModelReference" });

/** Browserbase viewport configuration. */
export const BrowserbaseViewportSchema = z
  .strictObject({
    width: z.number().optional(),
    height: z.number().optional(),
  })
  .meta({ id: "BrowserbaseViewport" });

/** Browserbase fingerprint screen configuration. */
export const BrowserbaseFingerprintScreenSchema = z
  .strictObject({
    maxHeight: z.number().optional(),
    maxWidth: z.number().optional(),
    minHeight: z.number().optional(),
    minWidth: z.number().optional(),
  })
  .meta({ id: "BrowserbaseFingerprintScreen" });

/** Browserbase fingerprint configuration for stealth mode. */
export const BrowserbaseFingerprintSchema = z
  .strictObject({
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
  .strictObject({
    id: z.string(),
    persist: z.boolean().optional(),
  })
  .meta({ id: "BrowserbaseContext" });

/** Browserbase browser settings for session creation. */
export const BrowserbaseBrowserSettingsSchema = z
  .strictObject({
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
  .strictObject({
    country: z.string(),
    city: z.string().optional(),
    state: z.string().optional(),
  })
  .meta({ id: "BrowserbaseProxyGeolocation" });

/** Browserbase managed proxy configuration. */
export const BrowserbaseProxyConfigSchema = z
  .strictObject({
    type: z.literal("browserbase"),
    domainPattern: z.string().optional(),
    geolocation: BrowserbaseProxyGeolocationSchema.optional(),
  })
  .meta({ id: "BrowserbaseProxyConfig" });

/** External proxy configuration. */
export const ExternalProxyConfigSchema = z
  .strictObject({
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
  .strictObject({
    browserSettings: BrowserbaseBrowserSettingsSchema.optional(),
    extensionId: z.string().optional(),
    keepAlive: z.boolean().optional(),
    proxies: z.union([z.boolean(), z.array(ProxyConfigSchema)]).optional(),
    region: BrowserbaseRegionSchema.optional(),
    timeout: z.number().optional(),
    userMetadata: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: "BrowserbaseSessionCreateParams" });

/** Browser session metadata used by provider-independent worker services. */
export const BrowserSessionMetadataSchema = z
  .strictObject({
    sessionId: z.string().min(1),
    region: BrowserbaseRegionSchema.optional(),
  })
  .meta({ id: "BrowserSessionMetadata" });

/** Browser launch options for local browsers. */
export const LocalBrowserLaunchOptionsSchema = z
  .strictObject({
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
      .strictObject({
        server: z.string(),
        bypass: z.string().optional(),
        username: z.string().optional(),
        password: z.string().optional(),
      })
      .optional(),
    locale: z.string().optional(),
    viewport: z.strictObject({ width: z.number(), height: z.number() }).optional(),
    deviceScaleFactor: z.number().optional(),
    hasTouch: z.boolean().optional(),
    ignoreHTTPSErrors: z.boolean().optional(),
    downloadsPath: z.string().optional(),
    acceptDownloads: z.boolean().optional(),
    keepAlive: z.boolean().optional(),
  })
  .meta({ id: "LocalBrowserLaunchOptions" });

/** Action object returned by observe and used by act */
export const ActionSchema = z
  .strictObject({
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

export const StagehandResultUsageSchema = z
  .strictObject({
    inputTokens: z.number().int().nonnegative().default(0).meta({
      description: "Input tokens consumed by all LLM calls made for this operation",
    }),
    outputTokens: z.number().int().nonnegative().default(0).meta({
      description: "Output tokens consumed by all LLM calls made for this operation",
    }),
    reasoningTokens: z.number().int().nonnegative().default(0).meta({
      description: "Reasoning tokens consumed by all LLM calls made for this operation",
    }),
    cachedInputTokens: z.number().int().nonnegative().default(0).meta({
      description: "Cached input tokens used by all LLM calls made for this operation",
    }),
    inferenceTimeMs: z.number().int().nonnegative().default(0).meta({
      description: "Total time spent waiting for LLM inference during this operation",
    }),
  })
  .meta({
    id: "StagehandResultUsage",
    description: "Aggregate LLM usage for one Stagehand operation",
  });

/** LLM tokens avoided by serving a request from the cache. */
export const CacheTokenSavingsSchema = z
  .strictObject({
    inputTokens: z.number().int().nonnegative().default(0),
    outputTokens: z.number().int().nonnegative().default(0),
    totalTokens: z.number().int().nonnegative().default(0),
  })
  .meta({ id: "CacheTokenSavings" });

/**
 * Cache observability for one act/observe/extract call. Always present, like
 * `usage`: DISABLED says no lookup ran, and otherwise it is self-explaining —
 * a miss carries why it missed, a hit carries how established the entry is.
 */
export const CacheMetadataSchema = z
  .strictObject({
    status: CacheStatusSchema.meta({
      description:
        "Whether server-side caching served this result, computed it, or was not consulted",
    }),
    count: z.number().int().nonnegative().optional().meta({
      description:
        "Times this cache key has been seen, including this request; compare with threshold to see how close the key is to being served",
    }),
    threshold: z.number().int().positive().optional().meta({
      description: "Hit-count threshold in effect for this key",
    }),
    missReason: z.string().optional().meta({
      description:
        'Why the cache did not serve this request; misses only. Reported by the server: "not_found", "threshold", "empty_array", "timeout", "error", "bypass", "screenshot", "not_enabled", "no_cache_key". Reported locally: "read_failed" (the cache request itself failed) and "replay_failed" (a cached value was found but could not be applied)',
    }),
    tokensSaved: CacheTokenSavingsSchema.optional().meta({
      description: "LLM tokens avoided by serving this request from cache; hits only",
    }),
  })
  .meta({ id: "CacheMetadata" });

export const StagehandResultMetadataSchema = z
  .strictObject({
    actionId: z.string().optional().meta({
      description: "Action ID for tracking",
    }),
    cache: CacheMetadataSchema.meta({
      description:
        "Cache observability for this result; status is DISABLED when no cache lookup ran",
    }),
    usage: StagehandResultUsageSchema.meta({
      description:
        "Aggregate LLM usage for this operation; zeroed when the operation did not run inference",
    }),
  })
  .meta({ id: "StagehandResultMetadata" });

export const ActOptionsSchema = z
  .strictObject({
    model: ModelConfigSchema.optional().meta({
      description:
        "Complete model configuration for this call; when omitted, the initialized Stagehand model is used, or Browserbase selects one automatically when no initialized model exists",
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
      description: "Serializable element locator for the action target",
    }),
    ignoreLocators: z
      .array(LocatorSchema)
      .optional()
      .meta({
        description:
          "Locators for elements and subtrees that should be excluded from action planning",
        example: [
          { selector: "nav" },
          { selector: ".cookie-banner" },
          { selector: "#sidebar-ads" },
        ],
      }),
    cache: CachingSchema.optional().meta({
      description: "Override the instance-level cache setting for this request",
    }),
  })
  .meta({ id: "ActOptions" });

/** Inner act result data */
export const ActResultDataSchema = z
  .strictObject({
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
  .strictObject({
    data: ActResultDataSchema,
    metadata: StagehandResultMetadataSchema,
  })
  .meta({ id: "ActResult" });

// =============================================================================
// Extract
// =============================================================================

export const ExtractOptionsSchema = z
  .strictObject({
    model: ModelConfigSchema.optional().meta({
      description:
        "Complete model configuration for this call; when omitted, the initialized Stagehand model is used, or Browserbase selects one automatically when no initialized model exists",
    }),
    timeout: z.number().optional().meta({
      description: "Timeout in ms for the extraction",
      example: 30000,
    }),
    locator: LocatorSchema.optional().meta({
      description: "Locator that scopes extraction to a specific element",
    }),
    ignoreLocators: z
      .array(LocatorSchema)
      .optional()
      .meta({
        description: "Locators for elements and subtrees that should be excluded from extraction",
        example: [
          { selector: "nav" },
          { selector: ".cookie-banner" },
          { selector: "#sidebar-ads" },
        ],
      }),
    screenshot: z.boolean().optional().meta({
      description:
        "When true, include a screenshot of the current viewport in the extraction LLM call. Defaults to false.",
      example: false,
    }),
    cache: CachingSchema.optional().meta({
      description: "Override the instance-level cache setting for this request",
    }),
  })
  .meta({ id: "ExtractOptions" });

export const ExtractResultSchema = z
  .strictObject({
    data: z.json().meta({
      description: "Extracted data matching the requested schema",
    }),
    metadata: StagehandResultMetadataSchema,
  })
  .meta({ id: "ExtractResult" });

// =============================================================================
// Observe
// =============================================================================

export const ObserveOptionsSchema = z
  .strictObject({
    model: ModelConfigSchema.optional().meta({
      description:
        "Complete model configuration for this call; when omitted, the initialized Stagehand model is used, or Browserbase selects one automatically when no initialized model exists",
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
    locator: LocatorSchema.optional().meta({
      description: "Locator that scopes observation to a specific element",
    }),
    ignoreLocators: z
      .array(LocatorSchema)
      .optional()
      .meta({
        description: "Locators for elements and subtrees that should be excluded from observation",
        example: [
          { selector: "nav" },
          { selector: ".cookie-banner" },
          { selector: "#sidebar-ads" },
        ],
      }),
    cache: CachingSchema.optional().meta({
      description: "Override the instance-level cache setting for this request",
    }),
  })
  .meta({ id: "ObserveOptions" });

export const ObserveResultSchema = z
  .strictObject({
    data: z.array(ActionSchema),
    metadata: StagehandResultMetadataSchema,
  })
  .meta({ id: "ObserveResult" });

export const EmptyParamsSchema = z.strictObject({}).meta({ id: "EmptyParams" });

export const LoadStateSchema = z
  .enum(["load", "domcontentloaded", "networkidle"])
  .meta({ id: "LoadState" });

const pageNavigationUrlSchema = z.string().min(1);

export const PageNavigationOptionsSchema = z
  .strictObject({
    waitUntil: LoadStateSchema.optional(),
    timeout: z.number().int().positive().optional(),
  })
  .meta({ id: "PageNavigationOptions" });

export const PageVoidResultSchema = z
  .strictObject({
    ok: z.literal(true),
  })
  .meta({ id: "PageVoidResult" });

export const ContextVoidResultSchema = z
  .strictObject({
    ok: z.literal(true),
  })
  .meta({ id: "ContextVoidResult" });

export const PageScreenshotClipSchema = z
  .strictObject({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .meta({ id: "PageScreenshotClip" });

export const SnapshotResultSchema = z
  .strictObject({
    formattedTree: z.string(),
    xpathMap: z.record(z.string(), z.string()),
    urlMap: z.record(z.string(), z.string()),
  })
  .meta({ id: "SnapshotResult" });

export const PageSnapshotOptionsSchema = z
  .strictObject({
    includeIframes: z.boolean().optional(),
  })
  .meta({ id: "PageSnapshotOptions" });

export const PageRefSchema = z
  .strictObject({
    pageId: z.string(),
    url: z.string().optional(),
    title: z.string().optional(),
  })
  .meta({ id: "PageRef" });

export const NavigationHeaderSchema = z
  .strictObject({
    name: z.string(),
    value: z.string(),
  })
  .meta({ id: "NavigationHeader" });

export const NavigationSecurityDetailsSchema = z
  .strictObject({
    issuer: z.string(),
    protocol: z.string(),
    subjectName: z.string(),
    validFrom: z.number(),
    validTo: z.number(),
  })
  .meta({ id: "NavigationSecurityDetails" });

export const NavigationServerAddrSchema = z
  .strictObject({
    ipAddress: z.string(),
    port: z.number().int().min(0).max(65_535),
  })
  .meta({ id: "NavigationServerAddr" });

export const NavigationFinishedErrorSchema = z
  .strictObject({
    message: z.string(),
  })
  .meta({ id: "NavigationFinishedError" });

export const NavigationResponseDescriptorSchema = z
  .strictObject({
    responseId: z.string().min(1),
    url: z.string(),
    status: z.number().int().nonnegative(),
    statusText: z.string(),
    headers: z.record(z.string(), z.string()),
    fromServiceWorker: z.boolean(),
  })
  .meta({ id: "NavigationResponseDescriptor" });

export const PageNavigationResultSchema = z
  .strictObject({
    page: PageRefSchema,
    response: NavigationResponseDescriptorSchema.nullable(),
  })
  .meta({ id: "PageNavigationResult" });

export const ResponseIdParamsSchema = z
  .strictObject({
    responseId: z.string().min(1),
  })
  .meta({ id: "ResponseIdParams" });

export const ResponseBodyResultSchema = z
  .strictObject({
    body: z.string(),
    base64Encoded: z.literal(true),
  })
  .meta({ id: "ResponseBodyResult" });

export const ResponseAllHeadersResultSchema = z
  .strictObject({
    headers: z.record(z.string(), z.string()),
  })
  .meta({ id: "ResponseAllHeadersResult" });

export const ResponseHeadersArrayResultSchema = z
  .strictObject({
    headers: z.array(NavigationHeaderSchema),
  })
  .meta({ id: "ResponseHeadersArrayResult" });

export const ResponseSecurityDetailsResultSchema = z
  .strictObject({
    value: NavigationSecurityDetailsSchema.nullable(),
  })
  .meta({ id: "ResponseSecurityDetailsResult" });

export const ResponseServerAddrResultSchema = z
  .strictObject({
    value: NavigationServerAddrSchema.nullable(),
  })
  .meta({ id: "ResponseServerAddrResult" });

export const ResponseFinishedResultSchema = z
  .strictObject({
    error: NavigationFinishedErrorSchema.nullable(),
  })
  .meta({ id: "ResponseFinishedResult" });

export const PageEventNameSchema = z.enum(["console"]).meta({ id: "PageEventName" });

export const PageCDPEventParamsSchema = z
  .record(z.string(), z.json())
  .meta({ id: "PageCDPEventParams" });

export const PageCDPEventSchema = z
  .strictObject({
    pageId: z.string().min(1),
    method: z.literal("Runtime.consoleAPICalled"),
    params: PageCDPEventParamsSchema,
    sessionId: z.string().min(1),
    targetId: z.string().min(1),
  })
  .meta({ id: "PageCDPEvent" });

export const PageCDPEventNotificationSchema = z
  .strictObject({
    subscriptionId: z.string().min(1),
    event: PageCDPEventSchema,
  })
  .meta({ id: "PageCDPEventNotification" });

export const WebMCPAnnotationSchema = z
  .strictObject({
    readOnly: z.boolean().optional(),
    untrustedContent: z.boolean().optional(),
    autosubmit: z.boolean().optional(),
  })
  .meta({ id: "WebMCPAnnotation" });

const WebMCPJsonValueSchema = z.json().meta({ id: "WebMCPJsonValue" });

export const WebMCPToolDescriptorSchema = z
  .strictObject({
    name: z.string().min(1),
    description: z.string(),
    inputSchema: z.record(z.string(), WebMCPJsonValueSchema).optional(),
    annotations: WebMCPAnnotationSchema.optional(),
    frameId: z.string().min(1),
    backendNodeId: z.number().int().nonnegative().optional(),
  })
  .meta({ id: "WebMCPToolDescriptor" });

export const WebMCPToolsOptionsSchema = z
  .strictObject({
    timeout: z.number().nonnegative().default(1_000),
  })
  .meta({ id: "WebMCPToolsOptions" });

export const WebMCPInvokeOptionsSchema = z
  .strictObject({
    input: z.record(z.string(), WebMCPJsonValueSchema).default({}),
  })
  .meta({ id: "WebMCPInvokeOptions" });

export const WebMCPResultOptionsSchema = z
  .strictObject({
    timeout: z.number().nonnegative().optional(),
  })
  .meta({ id: "WebMCPResultOptions" });

export const WebMCPInvocationDescriptorSchema = z
  .strictObject({
    invocationId: z.string().min(1),
    toolName: z.string().min(1),
    frameId: z.string().min(1),
    input: z.record(z.string(), WebMCPJsonValueSchema),
  })
  .meta({ id: "WebMCPInvocationDescriptor" });

export const WebMCPInvocationStatusSchema = z
  .enum(["Completed", "Canceled", "Error"])
  .meta({ id: "WebMCPInvocationStatus" });

export const WebMCPRemoteObjectSchema = z
  .record(z.string(), WebMCPJsonValueSchema)
  .meta({ id: "WebMCPRemoteObject" });

export const WebMCPToolResponseSchema = z
  .strictObject({
    invocationId: z.string().min(1),
    status: WebMCPInvocationStatusSchema,
    output: WebMCPJsonValueSchema.optional(),
    errorText: z.string().optional(),
    exception: WebMCPRemoteObjectSchema.optional(),
  })
  .meta({ id: "WebMCPToolResponse" });

export const LocatorDescriptorSchema = z
  .strictObject({
    pageId: z.string(),
    ...LocatorSchema.shape,
  })
  .meta({ id: "LocatorDescriptor" });

export const DEFAULT_TELEMETRY_CONFIG = {
  traces: {
    endpoint: "https://example.com/v1/traces", // TODO: Replace with the Browserbase OTLP traces ingestion endpoint.
    headers: {},
  },
};

export const ImplementationInfoSchema = z
  .strictObject({
    name: z.string().min(1),
    version: z.string().min(1),
  })
  .meta({ id: "ImplementationInfo" });

export const RuntimeDescriptorSchema = z
  .strictObject({
    protocolVersion: StagehandProtocolVersionSchema,
    serverInfo: ImplementationInfoSchema.extend({
      name: z.literal("stagehand"),
    }),
  })
  .meta({ id: "RuntimeDescriptor" });

export const TelemetryConfigSchema = z
  .strictObject({
    traces: z
      .strictObject({
        endpoint: z.url().refine((value) => new URL(value).pathname.endsWith("/v1/traces"), {
          message: "OTLP trace endpoint must end with /v1/traces",
        }),
        headers: z.record(z.string(), z.string()).default({}),
      })
      .meta({ id: "TelemetryTraces" }),
  })
  .meta({ id: "TelemetryConfig" });

export const StagehandInitParamsSchema = z
  .strictObject({
    protocolVersion: StagehandProtocolVersionSchema,
    clientInfo: ImplementationInfoSchema,
    browserCdpUrl: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
    apiUrl: z
      .url()
      .refine(
        (value) => !value.includes("?") && !value.includes("#"),
        "Stagehand apiUrl must not include a query string or fragment",
      )
      .refine((value) => !new URL(value).pathname.replace(/\/+$/, "").endsWith("/v1"), {
        message: "Stagehand apiUrl must be a service origin without /v1",
      })
      .optional()
      .meta({
        description:
          "Stagehand API base URL override for managed services such as Model Gateway and server-side caching",
      }),
    browser: BrowserSessionMetadataSchema.optional(),
    model: z.union([ModelConfigSchema, ClientModelReferenceSchema]).optional().meta({
      description:
        "Default model configuration; when omitted and a Browserbase Model Gateway session is available, Browserbase selects a model automatically for inference calls",
    }),
    telemetry: TelemetryConfigSchema.default(DEFAULT_TELEMETRY_CONFIG),
    logLevel: z.enum(["off", "error", "warn", "info", "debug"]).default("info"),
    systemPrompt: z.string().optional(),
    selfHeal: z.boolean().optional(),
    domSettleTimeoutMs: z.number().int().positive().optional(),
    cache: CachingSchema.optional().meta({
      description:
        "Server-side caching of act/observe/extract results for this instance: a boolean toggle, or an object with an optional hit-count threshold. Requires a Browserbase apiKey and browser sessionId. Can be overridden per request via options.cache.",
    }),
  })
  .meta({ id: "StagehandInitParams" });

export const StagehandActParamsSchema = z
  .strictObject({
    pageId: z.string().min(1),
    instruction: z.union([z.string().min(1), ActionSchema]),
    options: ActOptionsSchema.optional(),
  })
  .meta({ id: "StagehandActParams" });

export const StagehandObserveParamsSchema = z
  .strictObject({
    pageId: z.string().min(1),
    instruction: z.string().optional(),
    options: ObserveOptionsSchema.optional(),
  })
  .meta({ id: "StagehandObserveParams" });

export const DefaultExtractDataSchema = z
  .strictObject({
    extraction: z.string(),
  })
  .meta({ id: "DefaultExtractData" });

export const DEFAULT_EXTRACT_JSON_SCHEMA = z
  .json()
  .parse(z.toJSONSchema(z.strictObject({ extraction: z.string() }), { target: "draft-2020-12" }));

export const StagehandExtractParamsSchema = z
  .strictObject({
    pageId: z.string().min(1),
    instruction: z.string().min(1),
    schema: z.json().default(DEFAULT_EXTRACT_JSON_SCHEMA),
    options: ExtractOptionsSchema.optional(),
  })
  .meta({ id: "StagehandExtractParams" });

export const ContextNewPageParamsSchema = z
  .strictObject({
    url: pageNavigationUrlSchema.optional(),
  })
  .meta({ id: "ContextNewPageParams" });

export const ContextSetActivePageParamsSchema = z
  .strictObject({
    pageId: z.string(),
  })
  .meta({ id: "ContextSetActivePageParams" });

export const ContextAddInitScriptParamsSchema = z
  .strictObject({
    source: z.string(),
  })
  .meta({ id: "ContextAddInitScriptParams" });

export const ContextSetExtraHTTPHeadersParamsSchema = z
  .strictObject({
    headers: z.record(z.string(), z.string()),
  })
  .meta({ id: "ContextSetExtraHTTPHeadersParams" });

export const ContextSetDomainPolicyParamsSchema = z
  .strictObject({
    policy: DomainPolicySchema.nullable(),
  })
  .meta({ id: "ContextSetDomainPolicyParams" });

export const ContextCookiesParamsSchema = z
  .strictObject({
    urls: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .meta({ id: "ContextCookiesParams" });

export const ContextAddCookiesParamsSchema = z
  .strictObject({
    cookies: z.array(CookieParamSchema),
  })
  .meta({ id: "ContextAddCookiesParams" });

export const ContextClearCookiesParamsSchema = z
  .strictObject({
    options: ClearCookieOptionsSchema.optional(),
  })
  .meta({ id: "ContextClearCookiesParams" });

export const ContextClipboardTargetSchema = z
  .strictObject({
    pageId: z.string().optional(),
  })
  .meta({ id: "ContextClipboardTarget" });

export const ContextClipboardReadTextParamsSchema = ContextClipboardTargetSchema;

export const ContextClipboardWriteTextParamsSchema = ContextClipboardTargetSchema.extend({
  text: z.string(),
}).meta({ id: "ContextClipboardWriteTextParams" });

export const ContextClipboardClearParamsSchema = ContextClipboardTargetSchema;

export const ContextClipboardPasteParamsSchema = ContextClipboardTargetSchema.extend({
  shortcut: z.enum(["ControlOrMeta+V", "Meta+V", "Control+V"]).optional(),
}).meta({ id: "ContextClipboardPasteParams" });

export const ContextClipboardCopyParamsSchema = ContextClipboardTargetSchema;

export const ContextClipboardCutParamsSchema = ContextClipboardTargetSchema;

export const PageGotoParamsSchema = z
  .strictObject({
    pageId: z.string(),
    url: pageNavigationUrlSchema,
    options: PageNavigationOptionsSchema.optional(),
  })
  .meta({ id: "PageGotoParams" });

export const PageIdParamsSchema = z
  .strictObject({
    pageId: z.string(),
  })
  .meta({ id: "PageIdParams" });

export const PageOnParamsSchema = PageIdParamsSchema.extend({
  subscriptionId: z.string().min(1),
  event: PageEventNameSchema,
}).meta({ id: "PageOnParams" });

export const PageOffParamsSchema = z
  .strictObject({
    subscriptionId: z.string().min(1),
  })
  .meta({ id: "PageOffParams" });

export const PageWebMCPToolsParamsSchema = z
  .strictObject({
    ...PageIdParamsSchema.shape,
    options: WebMCPToolsOptionsSchema.optional(),
  })
  .meta({ id: "PageWebMCPToolsParams" });

export const PageWebMCPToolsResultSchema = z
  .strictObject({
    tools: z.array(WebMCPToolDescriptorSchema),
  })
  .meta({ id: "PageWebMCPToolsResult" });

export const PageWebMCPInvokeToolParamsSchema = z
  .strictObject({
    ...PageIdParamsSchema.shape,
    frameId: z.string().min(1),
    toolName: z.string().min(1),
    ...WebMCPInvokeOptionsSchema.shape,
  })
  .meta({ id: "PageWebMCPInvokeToolParams" });

export const PageWebMCPInvocationResultParamsSchema = z
  .strictObject({
    ...PageIdParamsSchema.shape,
    invocationId: z.string().min(1),
    options: WebMCPResultOptionsSchema.optional(),
  })
  .meta({ id: "PageWebMCPInvocationResultParams" });

export const PageWebMCPCancelInvocationParamsSchema = z
  .strictObject({
    ...PageIdParamsSchema.shape,
    invocationId: z.string().min(1),
  })
  .meta({ id: "PageWebMCPCancelInvocationParams" });

export const MouseButtonSchema = z.enum(["left", "right", "middle"]).meta({ id: "MouseButton" });

export const PageReloadParamsSchema = PageIdParamsSchema.extend({
  options: PageNavigationOptionsSchema.extend({
    ignoreCache: z.boolean().optional(),
  })
    .meta({ id: "PageReloadOptions" })
    .optional(),
}).meta({ id: "PageReloadParams" });

export const PageGoBackParamsSchema = PageIdParamsSchema.extend({
  options: PageNavigationOptionsSchema.optional(),
}).meta({ id: "PageGoBackParams" });

export const PageGoForwardParamsSchema = PageIdParamsSchema.extend({
  options: PageNavigationOptionsSchema.optional(),
}).meta({ id: "PageGoForwardParams" });

export const PageClickParamsSchema = PageIdParamsSchema.extend({
  x: z.number(),
  y: z.number(),
  options: z
    .strictObject({
      button: MouseButtonSchema.optional(),
      clickCount: z.number().int().positive().optional(),
    })
    .meta({ id: "PageClickOptions" })
    .optional(),
}).meta({ id: "PageClickParams" });

export const PageHoverParamsSchema = PageIdParamsSchema.extend({
  x: z.number(),
  y: z.number(),
}).meta({ id: "PageHoverParams" });

export const PageScrollParamsSchema = PageIdParamsSchema.extend({
  x: z.number(),
  y: z.number(),
  deltaX: z.number(),
  deltaY: z.number(),
}).meta({ id: "PageScrollParams" });

export const PageDragAndDropRoutePointSchema = z
  .strictObject({
    x: z.number(),
    y: z.number(),
  })
  .meta({ id: "PageDragAndDropRoutePoint" });

export const PageDragAndDropParamsSchema = PageIdParamsSchema.extend({
  fromX: z.number(),
  fromY: z.number(),
  toX: z.number(),
  toY: z.number(),
  options: z
    .strictObject({
      button: MouseButtonSchema.optional(),
      steps: z.number().int().positive().optional(),
      delay: z.number().nonnegative().optional(),
      route: z.array(PageDragAndDropRoutePointSchema).optional(),
    })
    .meta({ id: "PageDragAndDropOptions" })
    .optional(),
}).meta({ id: "PageDragAndDropParams" });

export const PageTypeParamsSchema = PageIdParamsSchema.extend({
  text: z.string(),
  options: z
    .strictObject({
      delay: z.number().nonnegative().optional(),
      withMistakes: z.boolean().optional(),
    })
    .meta({ id: "PageTypeOptions" })
    .optional(),
}).meta({ id: "PageTypeParams" });

export const PageKeyPressParamsSchema = PageIdParamsSchema.extend({
  key: z.string().min(1),
  options: z
    .strictObject({
      delay: z.number().nonnegative().optional(),
    })
    .meta({ id: "PageKeyPressOptions" })
    .optional(),
}).meta({ id: "PageKeyPressParams" });

export const PageEvaluateParamsSchema = PageIdParamsSchema.extend({
  expression: z.string(),
}).meta({ id: "PageEvaluateParams" });

export const PageAddInitScriptParamsSchema = PageIdParamsSchema.extend({
  source: z.string(),
}).meta({ id: "PageAddInitScriptParams" });

export const PageSetExtraHTTPHeadersParamsSchema = PageIdParamsSchema.extend({
  headers: z.record(z.string(), z.string()),
}).meta({ id: "PageSetExtraHTTPHeadersParams" });

export const PageScreenshotOptionsSchema = z
  .strictObject({
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
}).meta({ id: "PageScreenshotParams" });

export const PageSnapshotParamsSchema = PageIdParamsSchema.extend({
  options: PageSnapshotOptionsSchema.optional(),
}).meta({ id: "PageSnapshotParams" });

export const PageSetViewportSizeParamsSchema = PageIdParamsSchema.extend({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  options: z
    .strictObject({
      deviceScaleFactor: z.number().positive().optional(),
    })
    .meta({ id: "PageSetViewportSizeOptions" })
    .optional(),
}).meta({ id: "PageSetViewportSizeParams" });

export const PageWaitForLoadStateParamsSchema = PageIdParamsSchema.extend({
  state: LoadStateSchema,
  timeout: z.number().int().nonnegative().optional(),
}).meta({ id: "PageWaitForLoadStateParams" });

export const PageWaitForTimeoutParamsSchema = PageIdParamsSchema.extend({
  ms: z.number().int().nonnegative(),
}).meta({ id: "PageWaitForTimeoutParams" });

export const PageWaitForSelectorParamsSchema = PageIdParamsSchema.extend({
  selector: z.string().min(1),
  options: z
    .strictObject({
      state: z.enum(["attached", "detached", "visible", "hidden"]).optional(),
      timeout: z.number().int().nonnegative().optional(),
      pierceShadow: z.boolean().optional(),
    })
    .meta({ id: "PageWaitForSelectorOptions" })
    .optional(),
}).meta({ id: "PageWaitForSelectorParams" });

export const LocatorClickParamsSchema = LocatorDescriptorSchema.extend({
  options: z
    .strictObject({
      button: MouseButtonSchema.optional(),
      clickCount: z.number().int().positive().optional(),
    })
    .meta({ id: "LocatorClickOptions" })
    .optional(),
}).meta({ id: "LocatorClickParams" });

export const LocatorFillParamsSchema = LocatorDescriptorSchema.extend({
  value: z.string(),
}).meta({ id: "LocatorFillParams" });

export const LocatorScrollToParamsSchema = LocatorDescriptorSchema.extend({
  percent: z.union([z.number(), z.string()]),
}).meta({ id: "LocatorScrollToParams" });

export const RgbaColorSchema = z
  .strictObject({
    r: z.number(),
    g: z.number(),
    b: z.number(),
    a: z.number().optional(),
  })
  .meta({ id: "RgbaColor" });

export const LocatorHighlightParamsSchema = LocatorDescriptorSchema.extend({
  options: z
    .strictObject({
      durationMs: z.number().int().nonnegative().optional(),
      borderColor: RgbaColorSchema.optional(),
      contentColor: RgbaColorSchema.optional(),
    })
    .meta({ id: "LocatorHighlightOptions" })
    .optional(),
}).meta({ id: "LocatorHighlightParams" });

export const LocatorSendClickEventParamsSchema = LocatorDescriptorSchema.extend({
  options: z
    .strictObject({
      bubbles: z.boolean().optional(),
      cancelable: z.boolean().optional(),
      composed: z.boolean().optional(),
      detail: z.number().optional(),
    })
    .meta({ id: "LocatorSendClickEventOptions" })
    .optional(),
}).meta({ id: "LocatorSendClickEventParams" });

export const LocatorTypeParamsSchema = LocatorDescriptorSchema.extend({
  text: z.string(),
  options: z
    .strictObject({
      delay: z.number().nonnegative().optional(),
    })
    .meta({ id: "LocatorTypeOptions" })
    .optional(),
}).meta({ id: "LocatorTypeParams" });

export const LocatorSelectOptionParamsSchema = LocatorDescriptorSchema.extend({
  values: z.union([z.string(), z.array(z.string())]),
}).meta({ id: "LocatorSelectOptionParams" });

const MAX_INPUT_FILE_BYTES = 50 * 1024 * 1024;
const MAX_INPUT_FILE_BASE64_LENGTH = Math.ceil(MAX_INPUT_FILE_BYTES / 3) * 4;

export function decodedBase64ByteLength(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return (data.length / 4) * 3 - padding;
}

export const InputFilePayloadSchema = z
  .strictObject({
    name: z.string().min(1),
    mimeType: z.string().min(1).optional(),
    data: z
      .base64()
      .max(MAX_INPUT_FILE_BASE64_LENGTH)
      .refine((value) => decodedBase64ByteLength(value) <= MAX_INPUT_FILE_BYTES, {
        message: "File data must decode to 50 MiB or less",
      })
      .meta({ format: "byte" }),
    lastModified: z.number().int().nonnegative().optional(),
  })
  .meta({ id: "InputFilePayload" });

export const LocatorSetInputFilesParamsSchema = LocatorDescriptorSchema.extend({
  files: z.array(InputFilePayloadSchema),
}).meta({ id: "LocatorSetInputFilesParams" });

export const StagehandInitResultSchema = z
  .strictObject({
    initialized: z.literal(true),
    pages: z.array(PageRefSchema),
  })
  .meta({ id: "StagehandInitResult" });

export const StagehandCloseResultSchema = z
  .strictObject({
    closed: z.literal(true),
  })
  .meta({ id: "StagehandCloseResult" });

export const ContextPagesResultSchema = z.array(PageRefSchema).meta({ id: "ContextPagesResult" });

export const ContextActivePageResultSchema = PageRefSchema.nullable().meta({
  id: "ContextActivePageResult",
});

export const ContextGetDomainPolicyResultSchema = DomainPolicySchema.nullable().meta({
  id: "ContextGetDomainPolicyResult",
});

export const ContextCookiesResultSchema = z
  .array(CookieSchema)
  .meta({ id: "ContextCookiesResult" });

export const ContextClipboardReadTextResultSchema = z
  .string()
  .meta({ id: "ContextClipboardReadTextResult" });

export const PageUrlResultSchema = z.string().meta({ id: "PageUrlResult" });

export const PageTitleResultSchema = z.string().meta({ id: "PageTitleResult" });

export const PageCloseResultSchema = z
  .strictObject({
    closed: z.literal(true),
  })
  .meta({ id: "PageCloseResult" });

export const PageEvaluateResultSchema = z
  .strictObject({
    value: z.json(),
  })
  .meta({ id: "PageEvaluateResult" });

export const PageScreenshotResultSchema = z
  .strictObject({
    data: z.base64().meta({ format: "byte" }),
  })
  .meta({ id: "PageScreenshotResult" });

export const PageWaitForSelectorResultSchema = z
  .strictObject({
    matched: z.boolean(),
  })
  .meta({ id: "PageWaitForSelectorResult" });

export const LocatorClickResultSchema = z
  .strictObject({
    clicked: z.literal(true),
  })
  .meta({ id: "LocatorClickResult" });

export const LocatorFillResultSchema = z
  .strictObject({
    filled: z.literal(true),
  })
  .meta({ id: "LocatorFillResult" });

export const LocatorHoverResultSchema = z
  .strictObject({
    hovered: z.literal(true),
  })
  .meta({ id: "LocatorHoverResult" });

export const LocatorCountResultSchema = z
  .number()
  .int()
  .nonnegative()
  .meta({ id: "LocatorCountResult" });

export const LocatorIsCheckedResultSchema = z.boolean().meta({ id: "LocatorIsCheckedResult" });

export const LocatorInputValueResultSchema = z.string().meta({ id: "LocatorInputValueResult" });

export const LocatorIsVisibleResultSchema = z.boolean().meta({ id: "LocatorIsVisibleResult" });

export const LocatorInnerTextResultSchema = z.string().meta({ id: "LocatorInnerTextResult" });

export const LocatorInnerHtmlResultSchema = z.string().meta({ id: "LocatorInnerHtmlResult" });

export const LocatorTextContentResultSchema = z.string().meta({
  id: "LocatorTextContentResult",
});

export const LocatorScrollToResultSchema = z
  .strictObject({
    scrolled: z.literal(true),
  })
  .meta({ id: "LocatorScrollToResult" });

export const LocatorCentroidResultSchema = z
  .strictObject({
    x: z.number(),
    y: z.number(),
  })
  .meta({ id: "LocatorCentroidResult" });

export const LocatorHighlightResultSchema = z
  .strictObject({
    highlighted: z.literal(true),
  })
  .meta({ id: "LocatorHighlightResult" });

export const LocatorSendClickEventResultSchema = z
  .strictObject({
    clicked: z.literal(true),
  })
  .meta({ id: "LocatorSendClickEventResult" });

export const LocatorTypeResultSchema = z
  .strictObject({
    typed: z.literal(true),
  })
  .meta({ id: "LocatorTypeResult" });

export const LocatorSelectOptionResultSchema = z
  .array(z.string())
  .meta({ id: "LocatorSelectOptionResult" });

export const LocatorSetInputFilesResultSchema = z
  .strictObject({
    set: z.literal(true),
  })
  .meta({ id: "LocatorSetInputFilesResult" });

export const StagehandLogLevelSchema = z
  .enum(["debug", "info", "warn", "error"])
  .meta({ id: "StagehandLogLevel" });

export const StagehandLogDataSchema = z
  .record(z.string(), z.json())
  .meta({ id: "StagehandLogData" });

export const StagehandLogSchema = z
  .strictObject({
    level: StagehandLogLevelSchema,
    message: z.string().min(1),
    data: StagehandLogDataSchema,
  })
  .meta({ id: "StagehandLog" });
