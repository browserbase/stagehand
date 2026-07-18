import type { z } from "zod/v4";
import type {
  StagehandRpcNotificationSchema,
  StagehandRpcRequestSchema,
  StagehandMethodSchema,
  StagehandSendToHostBindingSchema,
} from "./schema-registry.js";
import type {
  ActionSchema,
  ActOptionsSchema,
  ActResultDataSchema,
  ActResultSchema,
  AnthropicModelIdSchema,
  AnthropicModelNameSchema,
  AzureEntraIdAuthSchema,
  AzureModelProviderOptionsSchema,
  AzureProviderOptionsSchema,
  BrowserGetVersionResultSchema,
  BrowserbaseBrowserSettingsSchema,
  BrowserbaseBrowserSourceSchema,
  BrowserbaseContextSchema,
  BrowserbaseFingerprintSchema,
  BrowserbaseFingerprintScreenSchema,
  BrowserbaseProxyConfigSchema,
  BrowserbaseProxyGeolocationSchema,
  BrowserbaseRegionSchema,
  BrowserbaseSessionCreateParamsSchema,
  BrowserbaseViewportSchema,
  CerebrasModelIdSchema,
  CerebrasModelNameSchema,
  ClientModelReferenceSchema,
  ContextNewPageParamsSchema,
  ContextPagesResultSchema,
  EmptyParamsSchema,
  ExternalProxyConfigSchema,
  ExtractOptionsSchema,
  ExtractResultSchema,
  CustomModelConfigSchema,
  GoogleModelIdSchema,
  GoogleModelNameSchema,
  GoogleServiceAccountAuthSchema,
  GoogleServiceAccountCredentialsSchema,
  LocatorClickParamsSchema,
  LocatorClickResultSchema,
  LocatorCentroidResultSchema,
  LocatorCountResultSchema,
  LocatorCoordinatesSchema,
  LocatorDescriptorSchema,
  LocatorFillParamsSchema,
  LocatorFillResultSchema,
  LocatorHighlightParamsSchema,
  LocatorHighlightResultSchema,
  LocatorHoverResultSchema,
  LocatorInnerHtmlResultSchema,
  LocatorInnerTextResultSchema,
  LocatorInputValueResultSchema,
  LocatorIsCheckedResultSchema,
  LocatorIsVisibleResultSchema,
  LocatorSchema,
  LocatorScrollToParamsSchema,
  LocatorScrollToResultSchema,
  LocatorSelectOptionParamsSchema,
  LocatorSelectOptionResultSchema,
  LocatorSendClickEventParamsSchema,
  LocatorSendClickEventResultSchema,
  LocatorTextContentResultSchema,
  LocatorTypeParamsSchema,
  LocatorTypeResultSchema,
  LoadStateSchema,
  LLMGenerateParamsSchema,
  LLMGenerateResultSchema,
  LLMAnnotationsSchema,
  LLMClientToolSchema,
  LLMImageContentSchema,
  LLMJsonSchemaResponseFormatSchema,
  LLMMessageSchema,
  LLMMessageContentBlockSchema,
  LLMMessageGenerateParamsSchema,
  LLMMessageGenerateResultSchema,
  LLMResponseFormatSchema,
  LLMRoleSchema,
  LLMStructuredGenerateParamsSchema,
  LLMStructuredGenerateResultSchema,
  LLMTextContentSchema,
  LLMTextResponseFormatSchema,
  LLMToolAnnotationsSchema,
  LLMToolChoiceSchema,
  LLMToolExecutionSchema,
  LLMToolIconSchema,
  LLMToolResultContentSchema,
  LLMToolUseContentSchema,
  LLMUsageSchema,
  MouseButtonSchema,
  ModelConfigSchema,
  ModelNameSchema,
  ModelProviderSchema,
  GroqModelIdSchema,
  GroqModelNameSchema,
  KnownModelConfigSchema,
  ObserveOptionsSchema,
  ObserveResultSchema,
  PageAddInitScriptParamsSchema,
  PageClickParamsSchema,
  PageCloseResultSchema,
  PageCoordinateResultSchema,
  PageDragAndDropParamsSchema,
  PageDragAndDropResultSchema,
  PageEvaluateParamsSchema,
  PageEvaluateResultSchema,
  PageGoBackParamsSchema,
  PageGoForwardParamsSchema,
  PageGotoParamsSchema,
  PageHoverParamsSchema,
  PageIdParamsSchema,
  PageKeyPressParamsSchema,
  PageLocatorSchema,
  PageNavigationOptionsSchema,
  PageRefSchema,
  PageReloadParamsSchema,
  PageScreenshotOptionsSchema,
  PageScreenshotParamsSchema,
  PageScreenshotClipSchema,
  PageScreenshotResultSchema,
  PageScrollParamsSchema,
  PageSetExtraHTTPHeadersParamsSchema,
  PageSetViewportSizeParamsSchema,
  PageSnapshotParamsSchema,
  PageSnapshotOptionsSchema,
  PageTitleResultSchema,
  PageTypeParamsSchema,
  PageUrlResultSchema,
  PageVoidResultSchema,
  PageWaitForLoadStateParamsSchema,
  PageWaitForSelectorParamsSchema,
  PageWaitForSelectorResultSchema,
  PageWaitForTimeoutParamsSchema,
  ProxyConfigSchema,
  RuntimeConfigureParamsSchema,
  RuntimeConfigureResultSchema,
  RuntimeLoopbackStatusResultSchema,
  RgbaColorSchema,
  StagehandActParamsSchema,
  StagehandCloseResultSchema,
  StagehandExtractParamsSchema,
  StagehandInitParamsSchema,
  StagehandInitResultSchema,
  StagehandLogDataSchema,
  StagehandLogLevelSchema,
  StagehandLogSchema,
  StagehandMetricsSchema,
  StagehandObserveParamsSchema,
  StagehandPingResultSchema,
  SnapshotResultSchema,
  TelemetryConfigSchema,
  OpenAIModelIdSchema,
  OpenAIModelNameSchema,
  VariablePrimitiveSchema,
  VariablesSchema,
  VariableValueSchema,
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
  ClearCookieOptionsSchema,
  ClientOptionsBaseSchema,
  ClientOptionsSchema,
  ClipboardOptionsSchema,
  ClipboardPasteOptionsSchema,
  CookieParamSchema,
  CookieSchema,
  DomainPolicySchema,
  ErrorResponseSchema,
  ExtractRequestSchema,
  ExtractResponseSchema,
  HistoryEntrySchema,
  LLMToolSchema,
  LocalBrowserLaunchOptionsSchema,
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
export type OpenAIModelId = z.infer<typeof OpenAIModelIdSchema>;
export type AnthropicModelId = z.infer<typeof AnthropicModelIdSchema>;
export type GoogleModelId = z.infer<typeof GoogleModelIdSchema>;
export type GroqModelId = z.infer<typeof GroqModelIdSchema>;
export type CerebrasModelId = z.infer<typeof CerebrasModelIdSchema>;
export type OpenAIModelName = z.infer<typeof OpenAIModelNameSchema>;
export type AnthropicModelName = z.infer<typeof AnthropicModelNameSchema>;
export type GoogleModelName = z.infer<typeof GoogleModelNameSchema>;
export type GroqModelName = z.infer<typeof GroqModelNameSchema>;
export type CerebrasModelName = z.infer<typeof CerebrasModelNameSchema>;
export type KnownModelConfig = z.infer<typeof KnownModelConfigSchema>;
export type CustomModelConfig = z.infer<typeof CustomModelConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type ModelName = z.infer<typeof ModelNameSchema>;
export type ModelProvider = z.infer<typeof ModelProviderSchema>;
export type LLMAnnotations = z.infer<typeof LLMAnnotationsSchema>;
export type LLMClientTool = z.infer<typeof LLMClientToolSchema>;
export type LLMImageContent = z.infer<typeof LLMImageContentSchema>;
export type LLMJsonSchemaResponseFormat = z.infer<typeof LLMJsonSchemaResponseFormatSchema>;
export type LLMMessage = z.infer<typeof LLMMessageSchema>;
export type LLMMessageContentBlock = z.infer<typeof LLMMessageContentBlockSchema>;
export type LLMMessageGenerateParams = z.infer<typeof LLMMessageGenerateParamsSchema>;
export type LLMMessageGenerateResult = z.infer<typeof LLMMessageGenerateResultSchema>;
export type LLMResponseFormat = z.infer<typeof LLMResponseFormatSchema>;
export type LLMRole = z.infer<typeof LLMRoleSchema>;
export type LLMStructuredGenerateParams = z.infer<typeof LLMStructuredGenerateParamsSchema>;
export type LLMStructuredGenerateResult = z.infer<typeof LLMStructuredGenerateResultSchema>;
export type LLMTextContent = z.infer<typeof LLMTextContentSchema>;
export type LLMTextResponseFormat = z.infer<typeof LLMTextResponseFormatSchema>;
export type LLMToolAnnotations = z.infer<typeof LLMToolAnnotationsSchema>;
export type LLMToolChoice = z.infer<typeof LLMToolChoiceSchema>;
export type LLMToolExecution = z.infer<typeof LLMToolExecutionSchema>;
export type LLMToolIcon = z.infer<typeof LLMToolIconSchema>;
export type LLMToolResultContent = z.infer<typeof LLMToolResultContentSchema>;
export type LLMToolUseContent = z.infer<typeof LLMToolUseContentSchema>;
export type LLMUsage = z.infer<typeof LLMUsageSchema>;
export type LLMGenerateParams = z.infer<typeof LLMGenerateParamsSchema>;
export type LLMGenerateResult = z.infer<typeof LLMGenerateResultSchema>;
export type ClientModelReference = z.infer<typeof ClientModelReferenceSchema>;
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
export type PageNavigationOptions = z.infer<typeof PageNavigationOptionsSchema>;
export type PageVoidResult = z.infer<typeof PageVoidResultSchema>;
export type PageCoordinateResult = z.infer<typeof PageCoordinateResultSchema>;
export type PageScreenshotClip = z.infer<typeof PageScreenshotClipSchema>;
export type PageSnapshotOptions = z.infer<typeof PageSnapshotOptionsSchema>;
export type SnapshotResult = z.infer<typeof SnapshotResultSchema>;
export type LocatorDescriptor = z.infer<typeof LocatorDescriptorSchema>;
export type StagehandInitParams = z.infer<typeof StagehandInitParamsSchema>;
export type TelemetryConfig = z.infer<typeof TelemetryConfigSchema>;
export type RuntimeConfigureParams = z.infer<typeof RuntimeConfigureParamsSchema>;
export type StagehandActParams = z.infer<typeof StagehandActParamsSchema>;
export type StagehandObserveParams = z.infer<typeof StagehandObserveParamsSchema>;
export type StagehandExtractParams = z.infer<typeof StagehandExtractParamsSchema>;
export type ContextNewPageParams = z.infer<typeof ContextNewPageParamsSchema>;
export type PageGotoParams = z.infer<typeof PageGotoParamsSchema>;
export type PageIdParams = z.infer<typeof PageIdParamsSchema>;
export type PageReloadParams = z.infer<typeof PageReloadParamsSchema>;
export type PageGoBackParams = z.infer<typeof PageGoBackParamsSchema>;
export type PageGoForwardParams = z.infer<typeof PageGoForwardParamsSchema>;
export type PageClickParams = z.infer<typeof PageClickParamsSchema>;
export type PageHoverParams = z.infer<typeof PageHoverParamsSchema>;
export type PageScrollParams = z.infer<typeof PageScrollParamsSchema>;
export type PageDragAndDropParams = z.infer<typeof PageDragAndDropParamsSchema>;
export type PageTypeParams = z.infer<typeof PageTypeParamsSchema>;
export type PageKeyPressParams = z.infer<typeof PageKeyPressParamsSchema>;
export type PageEvaluateParams = z.infer<typeof PageEvaluateParamsSchema>;
export type PageAddInitScriptParams = z.infer<typeof PageAddInitScriptParamsSchema>;
export type PageSetExtraHTTPHeadersParams = z.infer<typeof PageSetExtraHTTPHeadersParamsSchema>;
export type PageScreenshotOptions = z.infer<typeof PageScreenshotOptionsSchema>;
export type PageScreenshotParams = z.infer<typeof PageScreenshotParamsSchema>;
export type PageSnapshotParams = z.infer<typeof PageSnapshotParamsSchema>;
export type PageSetViewportSizeParams = z.infer<typeof PageSetViewportSizeParamsSchema>;
export type PageWaitForLoadStateParams = z.infer<typeof PageWaitForLoadStateParamsSchema>;
export type PageWaitForTimeoutParams = z.infer<typeof PageWaitForTimeoutParamsSchema>;
export type PageWaitForSelectorParams = z.infer<typeof PageWaitForSelectorParamsSchema>;
export type LocatorClickParams = z.infer<typeof LocatorClickParamsSchema>;
export type LocatorFillParams = z.infer<typeof LocatorFillParamsSchema>;
export type LocatorScrollToParams = z.infer<typeof LocatorScrollToParamsSchema>;
export type RgbaColor = z.infer<typeof RgbaColorSchema>;
export type LocatorHighlightParams = z.infer<typeof LocatorHighlightParamsSchema>;
export type LocatorSendClickEventParams = z.infer<typeof LocatorSendClickEventParamsSchema>;
export type LocatorTypeParams = z.infer<typeof LocatorTypeParamsSchema>;
export type LocatorSelectOptionParams = z.infer<typeof LocatorSelectOptionParamsSchema>;
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
export type PageDragAndDropResult = z.infer<typeof PageDragAndDropResultSchema>;
export type PageEvaluateResult = z.infer<typeof PageEvaluateResultSchema>;
export type PageScreenshotResult = z.infer<typeof PageScreenshotResultSchema>;
export type PageWaitForSelectorResult = z.infer<typeof PageWaitForSelectorResultSchema>;
export type LocatorClickResult = z.infer<typeof LocatorClickResultSchema>;
export type LocatorFillResult = z.infer<typeof LocatorFillResultSchema>;
export type LocatorHoverResult = z.infer<typeof LocatorHoverResultSchema>;
export type LocatorCountResult = z.infer<typeof LocatorCountResultSchema>;
export type LocatorIsCheckedResult = z.infer<typeof LocatorIsCheckedResultSchema>;
export type LocatorInputValueResult = z.infer<typeof LocatorInputValueResultSchema>;
export type LocatorIsVisibleResult = z.infer<typeof LocatorIsVisibleResultSchema>;
export type LocatorInnerTextResult = z.infer<typeof LocatorInnerTextResultSchema>;
export type LocatorInnerHtmlResult = z.infer<typeof LocatorInnerHtmlResultSchema>;
export type LocatorTextContentResult = z.infer<typeof LocatorTextContentResultSchema>;
export type LocatorScrollToResult = z.infer<typeof LocatorScrollToResultSchema>;
export type LocatorCentroidResult = z.infer<typeof LocatorCentroidResultSchema>;
export type LocatorHighlightResult = z.infer<typeof LocatorHighlightResultSchema>;
export type LocatorSendClickEventResult = z.infer<typeof LocatorSendClickEventResultSchema>;
export type LocatorTypeResult = z.infer<typeof LocatorTypeResultSchema>;
export type LocatorSelectOptionResult = z.infer<typeof LocatorSelectOptionResultSchema>;
export type StagehandLogData = z.infer<typeof StagehandLogDataSchema>;
export type StagehandLog = z.infer<typeof StagehandLogSchema>;
export type StagehandLogLevel = z.infer<typeof StagehandLogLevelSchema>;
export type StagehandRpcRequest = z.infer<typeof StagehandRpcRequestSchema>;
export type StagehandRpcNotification = z.infer<typeof StagehandRpcNotificationSchema>;
export type StagehandMethod = z.infer<typeof StagehandMethodSchema>;
export type StagehandSendToHostBinding = z.infer<typeof StagehandSendToHostBindingSchema>;

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
export type BrowserbaseBrowserSource = z.infer<typeof BrowserbaseBrowserSourceSchema>;
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
export type LocalBrowserLaunchOptions = z.infer<typeof LocalBrowserLaunchOptionsSchema>;
export type ModelAuth = z.infer<typeof ModelAuthSchema>;
export type ModelProviderOptions = z.infer<typeof ModelProviderOptionsSchema>;
export type OllamaResolvedProviderClientOptions = z.infer<
  typeof OllamaResolvedProviderClientOptionsSchema
>;
export type OpenAIClientOptions = z.infer<typeof OpenAIClientOptionsSchema>;
export type ResolvedProviderClientOptions = z.infer<typeof ResolvedProviderClientOptionsSchema>;
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
