import type Browserbase from "@browserbasehq/sdk";
import type { z } from "zod/v4";
import type {
  ActionSchema,
  ActRequestSchema,
  ActResponseSchema,
  ActResultDataSchema,
  ActResultSchema,
  AzureApiKeyModelConfigObjectSchema,
  AzureEntraIdAuthSchema,
  AzureEntraModelConfigObjectSchema,
  AzureModelConfigObjectSchema,
  AzureModelProviderOptionsSchema,
  AzureProviderOptionsSchema,
  BrowserConfigSchema,
  BrowserbaseBrowserSettingsSchema,
  BrowserbaseContextSchema,
  BrowserbaseFingerprintSchema,
  BrowserbaseFingerprintScreenSchema,
  BrowserbaseProxyConfigSchema,
  BrowserbaseProxyGeolocationSchema,
  BrowserbaseRegionSchema,
  BrowserbaseSessionCreateParamsSchema,
  BrowserbaseViewportSchema,
  ExtractRequestSchema,
  ExtractResponseSchema,
  ExtractResultSchema,
  ExternalProxyConfigSchema,
  GenericModelConfigObjectSchema,
  GoogleServiceAccountAuthSchema,
  GoogleServiceAccountCredentialsSchema,
  ModelAuthSchema,
  ModelConfigSchema,
  ModelProviderOptionsSchema,
  NavigateRequestSchema,
  NavigateResponseSchema,
  NavigateResultSchema,
  ObserveRequestSchema,
  ObserveResponseSchema,
  ObserveResultSchema,
  ProxyConfigSchema,
  ReplayActionSchema,
  ReplayPageSchema,
  ReplayResponseSchema,
  ReplayResultSchema,
  SessionEndResponseSchema,
  SessionEndResultSchema,
  SessionHeadersSchema,
  SessionIdParamsSchema,
  SessionStartRequestSchema,
  SessionStartResponseSchema,
  SessionStartResultSchema,
  StreamEventLogDataSchema,
  StreamEventSchema,
  StreamEventStatusSchema,
  StreamEventSystemDataSchema,
  StreamEventTypeSchema,
  TokenUsageSchema,
  VertexModelConfigObjectSchema,
  VertexModelProviderOptionsSchema,
  VertexProviderOptionsSchema,
} from "./schemas.js";

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
    description:
      "Deprecated. Browserbase API keys are now project-scoped, so this header is no longer required.",
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
    description: "Terminates the browser session and releases all associated resources.",
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
    description: "Extracts structured data from the current page using AI-powered analysis.",
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
export type GenericModelConfigObject = z.infer<typeof GenericModelConfigObjectSchema>;
export type VertexModelConfigObject = z.infer<typeof VertexModelConfigObjectSchema>;
export type AzureModelConfigObject = z.infer<typeof AzureModelConfigObjectSchema>;
export type AzureEntraModelConfigObject = z.infer<typeof AzureEntraModelConfigObjectSchema>;
export type AzureApiKeyModelConfigObject = z.infer<typeof AzureApiKeyModelConfigObjectSchema>;
export type GoogleServiceAccountCredentials = z.infer<typeof GoogleServiceAccountCredentialsSchema>;
export type GoogleServiceAccountAuth = z.infer<typeof GoogleServiceAccountAuthSchema>;
export type AzureEntraIdAuth = z.infer<typeof AzureEntraIdAuthSchema>;
export type ModelAuth = z.infer<typeof ModelAuthSchema>;
export type VertexProviderOptions = z.infer<typeof VertexProviderOptionsSchema>;
export type AzureProviderOptions = z.infer<typeof AzureProviderOptionsSchema>;
export type VertexModelProviderOptions = z.infer<typeof VertexModelProviderOptionsSchema>;
export type AzureModelProviderOptions = z.infer<typeof AzureModelProviderOptionsSchema>;
export type ModelProviderOptions = z.infer<typeof ModelProviderOptionsSchema>;
export type BrowserConfig = z.infer<typeof BrowserConfigSchema>;
export type SessionIdParams = z.infer<typeof SessionIdParamsSchema>;

// Header types
export type SessionHeaders = z.infer<typeof SessionHeadersSchema>;

// Browserbase types
export type BrowserbaseViewport = z.infer<typeof BrowserbaseViewportSchema>;
export type BrowserbaseFingerprintScreen = z.infer<typeof BrowserbaseFingerprintScreenSchema>;
export type BrowserbaseFingerprint = z.infer<typeof BrowserbaseFingerprintSchema>;
export type BrowserbaseContext = z.infer<typeof BrowserbaseContextSchema>;
export type BrowserbaseBrowserSettings = z.infer<typeof BrowserbaseBrowserSettingsSchema>;
export type BrowserbaseProxyGeolocation = z.infer<typeof BrowserbaseProxyGeolocationSchema>;
export type BrowserbaseProxyConfig = z.infer<typeof BrowserbaseProxyConfigSchema>;
export type ExternalProxyConfig = z.infer<typeof ExternalProxyConfigSchema>;
export type ProxyConfig = z.infer<typeof ProxyConfigSchema>;
export type BrowserbaseRegion = z.infer<typeof BrowserbaseRegionSchema>;
export type BrowserbaseSessionCreateParams = z.infer<typeof BrowserbaseSessionCreateParamsSchema>;

// Type check: ensure our schema-derived type is assignable to the SDK type
// This will cause a compile error if our schema drifts from the SDK
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _BrowserbaseSessionCreateParamsCheck =
  BrowserbaseSessionCreateParams extends Browserbase.Sessions.SessionCreateParams ? true : never;

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
