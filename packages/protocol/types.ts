import type { z } from "zod/v4";
import type {
  StagehandNotificationsSchema,
  StagehandRpcNotificationSchema,
  StagehandRpcRequestSchema,
} from "./schema-registry.js";
import type {
  ActionSchema,
  ActOptionsSchema,
  ActResultDataSchema,
  ActResultSchema,
  AzureApiKeyModelConfigObjectSchema,
  AzureEntraIdAuthSchema,
  AzureEntraModelConfigObjectSchema,
  AzureModelConfigObjectSchema,
  AzureModelProviderOptionsSchema,
  AzureProviderOptionsSchema,
  BrowserGetVersionResultSchema,
  ContextNewPageParamsSchema,
  ContextPagesResultSchema,
  EmptyParamsSchema,
  ExtractOptionsSchema,
  ExtractResultSchema,
  GenericModelConfigObjectSchema,
  GoogleServiceAccountAuthSchema,
  GoogleServiceAccountCredentialsSchema,
  LocatorClickParamsSchema,
  LocatorClickResultSchema,
  LocatorCoordinatesSchema,
  LocatorDescriptorSchema,
  LocatorFillParamsSchema,
  LocatorFillResultSchema,
  LocatorIsVisibleResultSchema,
  LocatorSchema,
  LocatorTextContentResultSchema,
  MouseButtonSchema,
  ModelConfigObjectSchema,
  ModelConfigurationSchema,
  ModelNameSchema,
  ModelProviderSchema,
  ObserveOptionsSchema,
  ObserveResultSchema,
  PageCloseResultSchema,
  PageGotoParamsSchema,
  PageIdParamsSchema,
  PageLocatorSchema,
  PageRefSchema,
  PageTitleResultSchema,
  PageUrlResultSchema,
  RuntimeConfigureParamsSchema,
  RuntimeConfigureResultSchema,
  RuntimeLoopbackStatusResultSchema,
  StagehandActParamsSchema,
  StagehandCloseResultSchema,
  StagehandExtractParamsSchema,
  StagehandInitParamsSchema,
  StagehandInitResultSchema,
  StagehandLogLevelSchema,
  StagehandLogSchema,
  StagehandMetricsSchema,
  StagehandObserveParamsSchema,
  StagehandPingResultSchema,
  StagehandTelemetryOptionsSchema,
  VariablePrimitiveSchema,
  VariablesSchema,
  VariableValueSchema,
  VertexModelConfigObjectSchema,
  VertexModelProviderOptionsSchema,
  VertexProviderOptionsSchema,
} from "./schemas.js";
import type {
  ActRequestSchema,
  ActResponseSchema,
  AISDKApiKeyProviderSchema,
  AnthropicClientOptionsSchema,
  ApiKeyAuthSchema,
  ApiKeyClientOptionsSchema,
  ApiKeyResolvedProviderClientOptionsSchema,
  AzureApiKeyClientOptionsSchema,
  AzureEntraClientOptionsSchema,
  AzureResolvedProviderClientOptionsSchema,
  BrowserConfigSchema,
  BrowserbaseBrowserSettingsSchema,
  BrowserbaseConnectOptionsSchema,
  BrowserbaseContextSchema,
  BrowserbaseFingerprintSchema,
  BrowserbaseFingerprintScreenSchema,
  BrowserbaseProxyConfigSchema,
  BrowserbaseProxyGeolocationSchema,
  BrowserbaseRegionSchema,
  BrowserbaseSessionCreateParamsSchema,
  BrowserbaseViewportSchema,
  ClearCookieOptionsSchema,
  ClientOptionsBaseSchema,
  ClientOptionsSchema,
  ClipboardOptionsSchema,
  ClipboardPasteOptionsSchema,
  CookieParamSchema,
  CookieSchema,
  DomainPolicySchema,
  ErrorResponseSchema,
  ExternalProxyConfigSchema,
  ExtractRequestSchema,
  ExtractResponseSchema,
  HistoryEntrySchema,
  LLMToolSchema,
  LoadStateSchema,
  LocalBrowserConnectOptionsSchema,
  LocalBrowserLaunchOptionsSchema,
  LogLevelSchema,
  LogLineSchema,
  ModelAuthSchema,
  ModelProviderOptionsSchema,
  NavigateOptionsSchema,
  NavigateRequestSchema,
  NavigateResponseSchema,
  NavigateResultSchema,
  ObserveRequestSchema,
  ObserveResponseSchema,
  OllamaResolvedProviderClientOptionsSchema,
  OpenAIClientOptionsSchema,
  PageSnapshotOptionsSchema,
  ProxyConfigSchema,
  ReplayActionSchema,
  ReplayPageSchema,
  ReplayResponseSchema,
  ReplayResultSchema,
  ResolvedProviderClientOptionsSchema,
  SessionEndResponseSchema,
  SessionEndRequestSchema,
  SessionEndResultSchema,
  SessionHeadersSchema,
  SessionIdParamsSchema,
  SessionStartRequestSchema,
  SessionStartResponseSchema,
  SessionStartResultSchema,
  SnapshotResultSchema,
  StagehandOptionsSchema,
  StreamEventLogDataSchema,
  StreamEventSchema,
  StreamEventStatusSchema,
  StreamEventSystemDataSchema,
  StreamEventTypeSchema,
  ThinkingEffortSchema,
  TokenUsageSchema,
  V3FunctionNameSchema,
  VertexClientOptionsSchema,
  VertexResolvedProviderClientOptionsSchema,
  defaultExtractSchema,
  pageTextSchema,
} from "./pending-schemas.js";

export type VariablePrimitive = z.infer<typeof VariablePrimitiveSchema>;
export type VariableValue = z.infer<typeof VariableValueSchema>;
export type Variables = z.infer<typeof VariablesSchema>;
export type LocatorCoordinates = z.infer<typeof LocatorCoordinatesSchema>;
export type PageLocator = z.infer<typeof PageLocatorSchema>;
export type Locator = z.infer<typeof LocatorSchema>;
export type MouseButton = z.infer<typeof MouseButtonSchema>;
export type StagehandMetrics = z.infer<typeof StagehandMetricsSchema>;
export type GoogleServiceAccountCredentials = z.infer<typeof GoogleServiceAccountCredentialsSchema>;
export type GoogleServiceAccountAuth = z.infer<typeof GoogleServiceAccountAuthSchema>;
export type AzureEntraIdAuth = z.infer<typeof AzureEntraIdAuthSchema>;
export type VertexProviderOptions = z.infer<typeof VertexProviderOptionsSchema>;
export type AzureProviderOptions = z.infer<typeof AzureProviderOptionsSchema>;
export type VertexModelProviderOptions = z.infer<typeof VertexModelProviderOptionsSchema>;
export type AzureModelProviderOptions = z.infer<typeof AzureModelProviderOptionsSchema>;
export type GenericModelConfigObject = z.infer<typeof GenericModelConfigObjectSchema>;
export type VertexModelConfigObject = z.infer<typeof VertexModelConfigObjectSchema>;
export type AzureEntraModelConfigObject = z.infer<typeof AzureEntraModelConfigObjectSchema>;
export type AzureApiKeyModelConfigObject = z.infer<typeof AzureApiKeyModelConfigObjectSchema>;
export type AzureModelConfigObject = z.infer<typeof AzureModelConfigObjectSchema>;
export type ModelConfigObject = z.infer<typeof ModelConfigObjectSchema>;
export type ModelConfiguration = z.infer<typeof ModelConfigurationSchema>;
export type ModelName = z.infer<typeof ModelNameSchema>;
export type ModelProvider = z.infer<typeof ModelProviderSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type ActOptions = z.infer<typeof ActOptionsSchema>;
export type ActResultData = z.infer<typeof ActResultDataSchema>;
export type ActResult = z.infer<typeof ActResultSchema>;
export type ExtractOptions = z.infer<typeof ExtractOptionsSchema>;
export type ExtractResult = z.infer<typeof ExtractResultSchema>;
export type ObserveOptions = z.infer<typeof ObserveOptionsSchema>;
export type ObserveResult = z.infer<typeof ObserveResultSchema>;
export type EmptyParams = z.infer<typeof EmptyParamsSchema>;
export type PageRef = z.infer<typeof PageRefSchema>;
export type LocatorDescriptor = z.infer<typeof LocatorDescriptorSchema>;
export type StagehandInitParams = z.infer<typeof StagehandInitParamsSchema>;
export type StagehandTelemetryOptions = z.infer<typeof StagehandTelemetryOptionsSchema>;
export type RuntimeConfigureParams = z.infer<typeof RuntimeConfigureParamsSchema>;
export type StagehandActParams = z.infer<typeof StagehandActParamsSchema>;
export type StagehandObserveParams = z.infer<typeof StagehandObserveParamsSchema>;
export type StagehandExtractParams = z.infer<typeof StagehandExtractParamsSchema>;
export type ContextNewPageParams = z.infer<typeof ContextNewPageParamsSchema>;
export type PageGotoParams = z.infer<typeof PageGotoParamsSchema>;
export type PageIdParams = z.infer<typeof PageIdParamsSchema>;
export type LocatorClickParams = z.infer<typeof LocatorClickParamsSchema>;
export type LocatorFillParams = z.infer<typeof LocatorFillParamsSchema>;
export type StagehandPingResult = z.infer<typeof StagehandPingResultSchema>;
export type RuntimeConfigureResult = z.infer<typeof RuntimeConfigureResultSchema>;
export type RuntimeLoopbackStatusResult = z.infer<typeof RuntimeLoopbackStatusResultSchema>;
export type BrowserGetVersionResult = z.infer<typeof BrowserGetVersionResultSchema>;
export type StagehandInitResult = z.infer<typeof StagehandInitResultSchema>;
export type StagehandCloseResult = z.infer<typeof StagehandCloseResultSchema>;
export type ContextPagesResult = z.infer<typeof ContextPagesResultSchema>;
export type PageUrlResult = z.infer<typeof PageUrlResultSchema>;
export type PageTitleResult = z.infer<typeof PageTitleResultSchema>;
export type PageCloseResult = z.infer<typeof PageCloseResultSchema>;
export type LocatorClickResult = z.infer<typeof LocatorClickResultSchema>;
export type LocatorFillResult = z.infer<typeof LocatorFillResultSchema>;
export type LocatorIsVisibleResult = z.infer<typeof LocatorIsVisibleResultSchema>;
export type LocatorTextContentResult = z.infer<typeof LocatorTextContentResultSchema>;
export type StagehandLog = z.infer<typeof StagehandLogSchema>;
export type StagehandLogLevel = z.infer<typeof StagehandLogLevelSchema>;
export type StagehandNotifications = z.infer<typeof StagehandNotificationsSchema>;
export type StagehandRpcRequest = z.infer<typeof StagehandRpcRequestSchema>;
export type StagehandRpcNotification = z.infer<typeof StagehandRpcNotificationSchema>;

export type AnthropicClientOptions = z.infer<typeof AnthropicClientOptionsSchema>;
export type AISDKApiKeyProvider = z.infer<typeof AISDKApiKeyProviderSchema>;
export type ApiKeyAuth = z.infer<typeof ApiKeyAuthSchema>;
export type ApiKeyClientOptions = z.infer<typeof ApiKeyClientOptionsSchema>;
export type ApiKeyResolvedProviderClientOptions = z.infer<
  typeof ApiKeyResolvedProviderClientOptionsSchema
>;
export type AzureApiKeyClientOptions = z.infer<typeof AzureApiKeyClientOptionsSchema>;
export type AzureEntraClientOptions = z.infer<typeof AzureEntraClientOptionsSchema>;
export type AzureResolvedProviderClientOptions = z.infer<
  typeof AzureResolvedProviderClientOptionsSchema
>;
export type BrowserbaseConnectOptions = z.infer<typeof BrowserbaseConnectOptionsSchema>;
export type BrowserbaseRegion = z.infer<typeof BrowserbaseRegionSchema>;
export type BrowserbaseSessionCreateParams = z.infer<typeof BrowserbaseSessionCreateParamsSchema>;
export type ClearCookieOptions = z.infer<typeof ClearCookieOptionsSchema>;
export type ClientOptions = z.infer<typeof ClientOptionsSchema>;
export type ClientOptionsBase = z.infer<typeof ClientOptionsBaseSchema>;
export type ClipboardOptions = z.infer<typeof ClipboardOptionsSchema>;
export type ClipboardPasteOptions = z.infer<typeof ClipboardPasteOptionsSchema>;
export type Cookie = z.infer<typeof CookieSchema>;
export type CookieParam = z.infer<typeof CookieParamSchema>;
export type DomainPolicy = z.infer<typeof DomainPolicySchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;
export type LLMTool = z.infer<typeof LLMToolSchema>;
export type LoadState = z.infer<typeof LoadStateSchema>;
export type LocalBrowserConnectOptions = z.infer<typeof LocalBrowserConnectOptionsSchema>;
export type LocalBrowserLaunchOptions = z.infer<typeof LocalBrowserLaunchOptionsSchema>;
export type LogLevel = z.infer<typeof LogLevelSchema>;
export type LogLine = z.infer<typeof LogLineSchema>;
export type ModelAuth = z.infer<typeof ModelAuthSchema>;
export type ModelProviderOptions = z.infer<typeof ModelProviderOptionsSchema>;
export type OllamaResolvedProviderClientOptions = z.infer<
  typeof OllamaResolvedProviderClientOptionsSchema
>;
export type OpenAIClientOptions = z.infer<typeof OpenAIClientOptionsSchema>;
export type PageSnapshotOptions = z.infer<typeof PageSnapshotOptionsSchema>;
export type ResolvedProviderClientOptions = z.infer<typeof ResolvedProviderClientOptionsSchema>;
export type SnapshotResult = z.infer<typeof SnapshotResultSchema>;
export type StagehandOptions = z.infer<typeof StagehandOptionsSchema>;
export type ThinkingEffort = z.infer<typeof ThinkingEffortSchema>;
export type V3FunctionName = z.infer<typeof V3FunctionNameSchema>;
export type VertexClientOptions = z.infer<typeof VertexClientOptionsSchema>;
export type VertexResolvedProviderClientOptions = z.infer<
  typeof VertexResolvedProviderClientOptionsSchema
>;

export type ActRequest = z.infer<typeof ActRequestSchema>;
export type ActResponse = z.infer<typeof ActResponseSchema>;
export type BrowserConfig = z.infer<typeof BrowserConfigSchema>;
export type BrowserbaseBrowserSettings = z.infer<typeof BrowserbaseBrowserSettingsSchema>;
export type BrowserbaseContext = z.infer<typeof BrowserbaseContextSchema>;
export type BrowserbaseFingerprint = z.infer<typeof BrowserbaseFingerprintSchema>;
export type BrowserbaseFingerprintScreen = z.infer<typeof BrowserbaseFingerprintScreenSchema>;
export type BrowserbaseProxyConfig = z.infer<typeof BrowserbaseProxyConfigSchema>;
export type BrowserbaseProxyGeolocation = z.infer<typeof BrowserbaseProxyGeolocationSchema>;
export type BrowserbaseViewport = z.infer<typeof BrowserbaseViewportSchema>;
export type ExternalProxyConfig = z.infer<typeof ExternalProxyConfigSchema>;
export type ExtractRequest = z.infer<typeof ExtractRequestSchema>;
export type ExtractResponse = z.infer<typeof ExtractResponseSchema>;
export type NavigateRequest = z.infer<typeof NavigateRequestSchema>;
export type NavigateOptions = z.infer<typeof NavigateOptionsSchema>;
export type NavigateResponse = z.infer<typeof NavigateResponseSchema>;
export type NavigateResult = z.infer<typeof NavigateResultSchema>;
export type ObserveRequest = z.infer<typeof ObserveRequestSchema>;
export type ObserveResponse = z.infer<typeof ObserveResponseSchema>;
export type ProxyConfig = z.infer<typeof ProxyConfigSchema>;
export type ReplayAction = z.infer<typeof ReplayActionSchema>;
export type ReplayPage = z.infer<typeof ReplayPageSchema>;
export type ReplayResponse = z.infer<typeof ReplayResponseSchema>;
export type ReplayResult = z.infer<typeof ReplayResultSchema>;
export type SessionEndResponse = z.infer<typeof SessionEndResponseSchema>;
export type SessionEndRequest = z.infer<typeof SessionEndRequestSchema>;
export type SessionEndResult = z.infer<typeof SessionEndResultSchema>;
export type SessionHeaders = z.infer<typeof SessionHeadersSchema>;
export type SessionIdParams = z.infer<typeof SessionIdParamsSchema>;
export type SessionStartRequest = z.infer<typeof SessionStartRequestSchema>;
export type SessionStartResponse = z.infer<typeof SessionStartResponseSchema>;
export type SessionStartResult = z.infer<typeof SessionStartResultSchema>;
export type StreamEvent = z.infer<typeof StreamEventSchema>;
export type StreamEventLogData = z.infer<typeof StreamEventLogDataSchema>;
export type StreamEventStatus = z.infer<typeof StreamEventStatusSchema>;
export type StreamEventSystemData = z.infer<typeof StreamEventSystemDataSchema>;
export type StreamEventType = z.infer<typeof StreamEventTypeSchema>;
export type TokenUsage = z.infer<typeof TokenUsageSchema>;
export type DefaultExtract = z.infer<typeof defaultExtractSchema>;
export type PageText = z.infer<typeof pageTextSchema>;
