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
  ApiKeyAuthSchema,
  AzureEntraIdAuthSchema,
  AzureModelProviderOptionsSchema,
  AzureProviderOptionsSchema,
  BrowserbaseBrowserSettingsSchema,
  BrowserSessionMetadataSchema,
  BrowserbaseContextSchema,
  BrowserbaseFingerprintSchema,
  BrowserbaseFingerprintScreenSchema,
  BrowserbaseProxyConfigSchema,
  BrowserbaseProxyGeolocationSchema,
  BrowserbaseRegionSchema,
  BrowserbaseSessionCreateParamsSchema,
  CallbackBatchOptionsSchema,
  CallbackBatchParamsSchema,
  CallbackBatchResultSchema,
  BrowserbaseViewportSchema,
  CacheMetadataSchema,
  CacheStatusSchema,
  CacheTokenSavingsSchema,
  CachingSchema,
  CerebrasModelIdSchema,
  CerebrasModelNameSchema,
  ClientOptionsBaseSchema,
  ClientOptionsSchema,
  ClientModelReferenceSchema,
  ClearCookieOptionsSchema,
  ContextActivePageResultSchema,
  ContextAddCookiesParamsSchema,
  ContextAddInitScriptParamsSchema,
  ContextClearCookiesParamsSchema,
  ContextClipboardClearParamsSchema,
  ContextClipboardCopyParamsSchema,
  ContextClipboardCutParamsSchema,
  ContextClipboardPasteParamsSchema,
  ContextClipboardReadTextParamsSchema,
  ContextClipboardReadTextResultSchema,
  ContextClipboardTargetSchema,
  ContextClipboardWriteTextParamsSchema,
  ContextCookiesParamsSchema,
  ContextCookiesResultSchema,
  ContextGetDomainPolicyResultSchema,
  ContextNewPageParamsSchema,
  ContextPagesResultSchema,
  ContextSetActivePageParamsSchema,
  ContextSetDomainPolicyParamsSchema,
  ContextSetExtraHTTPHeadersParamsSchema,
  ContextVoidResultSchema,
  CookieFilterSchema,
  CookieParamSchema,
  CookieRegexSchema,
  CookieSchema,
  DefaultExtractDataSchema,
  DomainPolicySchema,
  EmptyParamsSchema,
  ExternalProxyConfigSchema,
  ExtractOptionsSchema,
  ExtractResultSchema,
  GoogleModelIdSchema,
  GoogleModelNameSchema,
  GoogleServiceAccountAuthSchema,
  GoogleServiceAccountCredentialsSchema,
  ImplementationInfoSchema,
  InputFilePayloadSchema,
  LocatorClickParamsSchema,
  LocatorClickResultSchema,
  LocatorCentroidResultSchema,
  LocatorCountResultSchema,
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
  LocatorSetInputFilesParamsSchema,
  LocatorSetInputFilesResultSchema,
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
  LLMToolSchema,
  LLMToolAnnotationsSchema,
  LLMToolChoiceSchema,
  LLMToolExecutionSchema,
  LLMToolIconSchema,
  LLMToolResultContentSchema,
  LLMToolUseContentSchema,
  LLMUsageSchema,
  LocalBrowserLaunchOptionsSchema,
  MouseButtonSchema,
  NavigationFinishedErrorSchema,
  NavigationHeaderSchema,
  NavigationResponseDescriptorSchema,
  NavigationSecurityDetailsSchema,
  NavigationServerAddrSchema,
  ModelAuthSchema,
  ModelConfigSchema,
  ModelNameSchema,
  ModelProviderOptionsSchema,
  ModelProviderSchema,
  GroqModelIdSchema,
  GroqModelNameSchema,
  ObserveOptionsSchema,
  ObserveResultSchema,
  PageAddInitScriptParamsSchema,
  PageCDPEventNotificationSchema,
  PageCDPEventParamsSchema,
  PageCDPEventSchema,
  PageClickParamsSchema,
  PageCloseResultSchema,
  PageDragAndDropParamsSchema,
  PageDragAndDropRoutePointSchema,
  PageEvaluateParamsSchema,
  PageEvaluateResultSchema,
  PageGoBackParamsSchema,
  PageGoForwardParamsSchema,
  PageGotoParamsSchema,
  PageHoverParamsSchema,
  PageIdParamsSchema,
  PageKeyPressParamsSchema,
  PageEventNameSchema,
  PageLocatorSchema,
  PageNavigationResultSchema,
  PageNavigationOptionsSchema,
  PageOffParamsSchema,
  PageOnParamsSchema,
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
  PageWebMCPCancelInvocationParamsSchema,
  PageWebMCPInvocationResultParamsSchema,
  PageWebMCPInvokeToolParamsSchema,
  PageWebMCPToolsParamsSchema,
  PageWebMCPToolsResultSchema,
  ProxyConfigSchema,
  ResponseAllHeadersResultSchema,
  ResponseBodyResultSchema,
  ResponseFinishedResultSchema,
  ResponseHeadersArrayResultSchema,
  ResponseIdParamsSchema,
  ResponseSecurityDetailsResultSchema,
  ResponseServerAddrResultSchema,
  RuntimeDescriptorSchema,
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
  StagehandResultMetadataSchema,
  StagehandResultUsageSchema,
  SnapshotResultSchema,
  TelemetryConfigSchema,
  ThinkingEffortSchema,
  OpenAIModelIdSchema,
  OpenAIModelNameSchema,
  VariablePrimitiveSchema,
  VariablesSchema,
  VariableValueSchema,
  VertexModelProviderOptionsSchema,
  VertexProviderOptionsSchema,
  WebMCPAnnotationSchema,
  WebMCPInvocationDescriptorSchema,
  WebMCPInvocationStatusSchema,
  WebMCPInvokeOptionsSchema,
  WebMCPRemoteObjectSchema,
  WebMCPResultOptionsSchema,
  WebMCPToolDescriptorSchema,
  WebMCPToolResponseSchema,
  WebMCPToolsOptionsSchema,
} from "./schemas.js";

export type VariablePrimitive = z.infer<typeof VariablePrimitiveSchema>;
export type VariableValue = z.infer<typeof VariableValueSchema>;
export type Variables = z.infer<typeof VariablesSchema>;
export type PageLocator = z.infer<typeof PageLocatorSchema>;
export type Locator = z.infer<typeof LocatorSchema>;
export type MouseButton = z.infer<typeof MouseButtonSchema>;
export type StagehandMetrics = z.infer<typeof StagehandMetricsSchema>;
export type CallbackBatchOptions = z.infer<typeof CallbackBatchOptionsSchema>;
export type CallbackBatchParams = z.infer<typeof CallbackBatchParamsSchema>;
export type CallbackBatchResult = z.infer<typeof CallbackBatchResultSchema>;
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
export type DefaultExtractData = z.infer<typeof DefaultExtractDataSchema>;
export type ObserveOptions = z.infer<typeof ObserveOptionsSchema>;
export type ObserveResult = z.infer<typeof ObserveResultSchema>;
export type EmptyParams = z.infer<typeof EmptyParamsSchema>;
export type ContextVoidResult = z.infer<typeof ContextVoidResultSchema>;
export type PageRef = z.infer<typeof PageRefSchema>;
export type PageEventName = z.infer<typeof PageEventNameSchema>;
export type PageCDPEventParams = z.infer<typeof PageCDPEventParamsSchema>;
export type PageCDPEvent = z.infer<typeof PageCDPEventSchema>;
export type PageCDPEventNotification = z.infer<typeof PageCDPEventNotificationSchema>;
export type PageNavigationOptions = z.infer<typeof PageNavigationOptionsSchema>;
export type NavigationHeader = z.infer<typeof NavigationHeaderSchema>;
export type NavigationSecurityDetails = z.infer<typeof NavigationSecurityDetailsSchema>;
export type NavigationServerAddr = z.infer<typeof NavigationServerAddrSchema>;
export type NavigationFinishedError = z.infer<typeof NavigationFinishedErrorSchema>;
export type NavigationResponseDescriptor = z.infer<typeof NavigationResponseDescriptorSchema>;
export type PageNavigationResult = z.infer<typeof PageNavigationResultSchema>;
export type ResponseIdParams = z.infer<typeof ResponseIdParamsSchema>;
export type ResponseBodyResult = z.infer<typeof ResponseBodyResultSchema>;
export type ResponseAllHeadersResult = z.infer<typeof ResponseAllHeadersResultSchema>;
export type ResponseHeadersArrayResult = z.infer<typeof ResponseHeadersArrayResultSchema>;
export type ResponseSecurityDetailsResult = z.infer<typeof ResponseSecurityDetailsResultSchema>;
export type ResponseServerAddrResult = z.infer<typeof ResponseServerAddrResultSchema>;
export type ResponseFinishedResult = z.infer<typeof ResponseFinishedResultSchema>;
export type PageVoidResult = z.infer<typeof PageVoidResultSchema>;
export type PageScreenshotClip = z.infer<typeof PageScreenshotClipSchema>;
export type PageSnapshotOptions = z.infer<typeof PageSnapshotOptionsSchema>;
export type SnapshotResult = z.infer<typeof SnapshotResultSchema>;
export type WebMCPAnnotation = z.infer<typeof WebMCPAnnotationSchema>;
export type WebMCPToolDescriptor = z.infer<typeof WebMCPToolDescriptorSchema>;
export type WebMCPToolsOptions = z.infer<typeof WebMCPToolsOptionsSchema>;
export type WebMCPInvokeOptions = z.infer<typeof WebMCPInvokeOptionsSchema>;
export type WebMCPResultOptions = z.infer<typeof WebMCPResultOptionsSchema>;
export type WebMCPInvocationDescriptor = z.infer<typeof WebMCPInvocationDescriptorSchema>;
export type WebMCPInvocationStatus = z.infer<typeof WebMCPInvocationStatusSchema>;
export type WebMCPRemoteObject = z.infer<typeof WebMCPRemoteObjectSchema>;
export type WebMCPToolResponse = z.infer<typeof WebMCPToolResponseSchema>;
export type LocatorDescriptor = z.infer<typeof LocatorDescriptorSchema>;
export type StagehandInitParams = z.infer<typeof StagehandInitParamsSchema>;
export type TelemetryConfig = z.infer<typeof TelemetryConfigSchema>;
export type ImplementationInfo = z.infer<typeof ImplementationInfoSchema>;
export type RuntimeDescriptor = z.infer<typeof RuntimeDescriptorSchema>;
export type StagehandActParams = z.infer<typeof StagehandActParamsSchema>;
export type StagehandObserveParams = z.infer<typeof StagehandObserveParamsSchema>;
export type StagehandExtractParams = z.infer<typeof StagehandExtractParamsSchema>;
export type ContextNewPageParams = z.infer<typeof ContextNewPageParamsSchema>;
export type ContextCookiesParams = z.infer<typeof ContextCookiesParamsSchema>;
export type ContextAddCookiesParams = z.infer<typeof ContextAddCookiesParamsSchema>;
export type ContextClearCookiesParams = z.infer<typeof ContextClearCookiesParamsSchema>;
export type ContextClipboardTarget = z.infer<typeof ContextClipboardTargetSchema>;
export type ContextClipboardReadTextParams = z.infer<typeof ContextClipboardReadTextParamsSchema>;
export type ContextClipboardWriteTextParams = z.infer<typeof ContextClipboardWriteTextParamsSchema>;
export type ContextClipboardClearParams = z.infer<typeof ContextClipboardClearParamsSchema>;
export type ContextClipboardPasteParams = z.infer<typeof ContextClipboardPasteParamsSchema>;
export type ContextClipboardCopyParams = z.infer<typeof ContextClipboardCopyParamsSchema>;
export type ContextClipboardCutParams = z.infer<typeof ContextClipboardCutParamsSchema>;
export type ContextSetActivePageParams = z.infer<typeof ContextSetActivePageParamsSchema>;
export type ContextAddInitScriptParams = z.infer<typeof ContextAddInitScriptParamsSchema>;
export type ContextSetExtraHTTPHeadersParams = z.infer<
  typeof ContextSetExtraHTTPHeadersParamsSchema
>;
export type ContextSetDomainPolicyParams = z.infer<typeof ContextSetDomainPolicyParamsSchema>;
export type PageGotoParams = z.infer<typeof PageGotoParamsSchema>;
export type PageOnParams = z.infer<typeof PageOnParamsSchema>;
export type PageOffParams = z.infer<typeof PageOffParamsSchema>;
export type PageIdParams = z.infer<typeof PageIdParamsSchema>;
export type PageReloadParams = z.infer<typeof PageReloadParamsSchema>;
export type PageGoBackParams = z.infer<typeof PageGoBackParamsSchema>;
export type PageGoForwardParams = z.infer<typeof PageGoForwardParamsSchema>;
export type PageClickParams = z.infer<typeof PageClickParamsSchema>;
export type PageHoverParams = z.infer<typeof PageHoverParamsSchema>;
export type PageScrollParams = z.infer<typeof PageScrollParamsSchema>;
export type PageDragAndDropParams = z.infer<typeof PageDragAndDropParamsSchema>;
export type PageDragAndDropRoutePoint = z.infer<typeof PageDragAndDropRoutePointSchema>;
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
export type PageWebMCPToolsParams = z.infer<typeof PageWebMCPToolsParamsSchema>;
export type PageWebMCPToolsResult = z.infer<typeof PageWebMCPToolsResultSchema>;
export type PageWebMCPInvokeToolParams = z.infer<typeof PageWebMCPInvokeToolParamsSchema>;
export type PageWebMCPInvocationResultParams = z.infer<
  typeof PageWebMCPInvocationResultParamsSchema
>;
export type PageWebMCPCancelInvocationParams = z.infer<
  typeof PageWebMCPCancelInvocationParamsSchema
>;
export type LocatorClickParams = z.infer<typeof LocatorClickParamsSchema>;
export type LocatorFillParams = z.infer<typeof LocatorFillParamsSchema>;
export type LocatorScrollToParams = z.infer<typeof LocatorScrollToParamsSchema>;
export type RgbaColor = z.infer<typeof RgbaColorSchema>;
export type LocatorHighlightParams = z.infer<typeof LocatorHighlightParamsSchema>;
export type LocatorSendClickEventParams = z.infer<typeof LocatorSendClickEventParamsSchema>;
export type LocatorTypeParams = z.infer<typeof LocatorTypeParamsSchema>;
export type LocatorSelectOptionParams = z.infer<typeof LocatorSelectOptionParamsSchema>;
export type InputFilePayload = z.infer<typeof InputFilePayloadSchema>;
export type LocatorSetInputFilesParams = z.infer<typeof LocatorSetInputFilesParamsSchema>;
export type CacheStatus = z.infer<typeof CacheStatusSchema>;
export type CacheTokenSavings = z.infer<typeof CacheTokenSavingsSchema>;
export type CacheMetadata = z.infer<typeof CacheMetadataSchema>;
export type StagehandResultUsage = z.infer<typeof StagehandResultUsageSchema>;
export type StagehandResultMetadata = z.infer<typeof StagehandResultMetadataSchema>;
export type StagehandInitResult = z.infer<typeof StagehandInitResultSchema>;
export type StagehandCloseResult = z.infer<typeof StagehandCloseResultSchema>;
export type ContextPagesResult = z.infer<typeof ContextPagesResultSchema>;
export type ContextCookiesResult = z.infer<typeof ContextCookiesResultSchema>;
export type ContextClipboardReadTextResult = z.infer<typeof ContextClipboardReadTextResultSchema>;
export type ContextActivePageResult = z.infer<typeof ContextActivePageResultSchema>;
export type ContextGetDomainPolicyResult = z.infer<typeof ContextGetDomainPolicyResultSchema>;
export type PageUrlResult = z.infer<typeof PageUrlResultSchema>;
export type PageTitleResult = z.infer<typeof PageTitleResultSchema>;
export type PageCloseResult = z.infer<typeof PageCloseResultSchema>;
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
export type LocatorSetInputFilesResult = z.infer<typeof LocatorSetInputFilesResultSchema>;
export type StagehandLogData = z.infer<typeof StagehandLogDataSchema>;
export type StagehandLog = z.infer<typeof StagehandLogSchema>;
export type StagehandLogLevel = z.infer<typeof StagehandLogLevelSchema>;
export type StagehandRpcRequest = z.infer<typeof StagehandRpcRequestSchema>;
export type StagehandRpcNotification = z.infer<typeof StagehandRpcNotificationSchema>;
export type StagehandMethod = z.infer<typeof StagehandMethodSchema>;
export type StagehandSendToHostBinding = z.infer<typeof StagehandSendToHostBindingSchema>;

export type ApiKeyAuth = z.infer<typeof ApiKeyAuthSchema>;
export type BrowserSessionMetadata = z.infer<typeof BrowserSessionMetadataSchema>;
export type BrowserbaseRegion = z.infer<typeof BrowserbaseRegionSchema>;
export type BrowserbaseSessionCreateParams = z.infer<typeof BrowserbaseSessionCreateParamsSchema>;
export type Caching = z.infer<typeof CachingSchema>;
export type ClearCookieOptions = z.infer<typeof ClearCookieOptionsSchema>;
export type ClientOptions = z.infer<typeof ClientOptionsSchema>;
export type ClientOptionsBase = z.infer<typeof ClientOptionsBaseSchema>;
export type Cookie = z.infer<typeof CookieSchema>;
export type CookieFilter = z.infer<typeof CookieFilterSchema>;
export type CookieParam = z.infer<typeof CookieParamSchema>;
export type CookieRegex = z.infer<typeof CookieRegexSchema>;
export type DomainPolicy = z.infer<typeof DomainPolicySchema>;
export type LLMTool = z.infer<typeof LLMToolSchema>;
export type LoadState = z.infer<typeof LoadStateSchema>;
export type LocalBrowserLaunchOptions = z.infer<typeof LocalBrowserLaunchOptionsSchema>;
export type ModelAuth = z.infer<typeof ModelAuthSchema>;
export type ModelProviderOptions = z.infer<typeof ModelProviderOptionsSchema>;
export type ThinkingEffort = z.infer<typeof ThinkingEffortSchema>;

export type BrowserbaseBrowserSettings = z.infer<typeof BrowserbaseBrowserSettingsSchema>;
export type BrowserbaseContext = z.infer<typeof BrowserbaseContextSchema>;
export type BrowserbaseFingerprint = z.infer<typeof BrowserbaseFingerprintSchema>;
export type BrowserbaseFingerprintScreen = z.infer<typeof BrowserbaseFingerprintScreenSchema>;
export type BrowserbaseProxyConfig = z.infer<typeof BrowserbaseProxyConfigSchema>;
export type BrowserbaseProxyGeolocation = z.infer<typeof BrowserbaseProxyGeolocationSchema>;
export type BrowserbaseViewport = z.infer<typeof BrowserbaseViewportSchema>;
export type ExternalProxyConfig = z.infer<typeof ExternalProxyConfigSchema>;
export type ProxyConfig = z.infer<typeof ProxyConfigSchema>;
