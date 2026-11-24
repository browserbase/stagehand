export {
  BrowserContext,
  type ClearCookieOptions,
  type Cookie,
  type CookieParam,
  type DomainPolicy,
} from "@browserbasehq/stagehand-browser-api/browserContext";
export {
  BrowserClipboard,
  type ClipboardOptions,
  type ClipboardPasteOptions,
} from "@browserbasehq/stagehand-browser-api/browserClipboard";
export {
  Locator,
  type LocatorOptions,
  type GetByTextOptions,
  type LocatorClickOptions,
  type LocatorHighlightOptions,
  type LocatorSendClickEventOptions,
  type LocatorTypeOptions,
} from "@browserbasehq/stagehand-browser-api/locator";
export type { FileInput, FilePayload } from "@browserbasehq/stagehand-browser-api/fileUpload";
export {
  CDPSubscription,
  Page,
  type PageClickOptions,
  type PageDragAndDropOptions,
  type ConsoleListener,
  type PageEventListener,
  type ResponseListener,
  type ToolsAddedListener,
  type ToolsRemovedListener,
  type PageKeyPressOptions,
  type PageReloadOptions,
  type PDFOptions,
  type PageSetViewportSizeOptions,
  type PageTypeOptions,
  type PageWaitForSelectorOptions,
  type PageWaitForFunctionOptions,
  type ScreenshotOptions,
} from "@browserbasehq/stagehand-browser-api/page";
export {
  Response,
  type ResponseHeader,
  type ResponseSecurityDetails,
  type ResponseServerAddr,
} from "@browserbasehq/stagehand-browser-api/response";
export { WebMCPInvocation, WebMCPTool } from "@browserbasehq/stagehand-browser-api/webmcp";
export { CDPConnectionClosedError } from "./cdpClient.js";
export { RPCResponseTimeoutError } from "./rpcErrors.js";
export type { InitScriptSource } from "@browserbasehq/stagehand-browser-api/pageScripts";
export { Stagehand, type ExtractResult } from "./stagehand.js";
export { StagehandRuntimeIncompatibleError } from "./cdpClient.js";
export type {
  ReportedRuntimeDescriptor,
  RuntimeCompatibility,
  RuntimeIncompatibilityReason,
  RuntimeRequirement,
} from "./runtimeCompatibility.js";
export {
  CALLBACK_BATCH_CLIENT_GRACE_MS,
  StagehandBatchTimeoutError,
  type ExperimentalBatchCallback,
  type ExperimentalBatchBrowserContext,
  type ExperimentalBatchContext,
  type ExperimentalBatchExtractOptions,
  type ExperimentalBatchOptions,
} from "./batch.js";
export { browserbase, localBrowser } from "./browser/factories.js";
export type {
  BrowserbaseBrowser,
  BrowserbaseClientOptions,
  BrowserbaseConnectOptions,
  BrowserbaseFetchOptions,
  BrowserbaseFetchResult,
  BrowserbaseLaunchOptions,
  BrowserbaseSearchOptions,
  BrowserbaseSearchResult,
  LocalBrowser,
  LocalBrowserConnectOptions,
  LocalBrowserLaunchOptions,
  StagehandBrowser,
  StagehandBrowserOrigin,
  StagehandBrowserProvider,
} from "./browser/index.js";
export type {
  Action,
  ActResultData,
  ActResult,
  CacheMetadata,
  CacheStatus,
  CacheTokenSavings,
  Caching,
  LoadState,
  LocatorCentroidResult,
  ModelConfig,
  ModelName,
  MouseButton,
  ObserveResult,
  PageCDPEvent,
  PageDragAndDropRoutePoint,
  PageEventName,
  PageNavigationOptions,
  PagePDFMargin,
  PagePDFOptions,
  PageScreenshotClip,
  PageSnapshotOptions,
  RgbaColor,
  SnapshotResult,
  StagehandMetrics,
  StagehandResultMetadata,
  StagehandResultUsage,
  Variables,
  WebMCPAnnotation,
  WebMCPInvocationStatus,
  WebMCPRemoteObject,
  WebMCPToolResponse,
  WebMCPToolIdentity,
} from "@browserbasehq/stagehand-protocol/types";
export {
  BrowserbaseConnectOptionsSchema,
  BrowserbaseFetchOptionsSchema,
  BrowserbaseFetchResultSchema,
  BrowserbaseLaunchOptionsSchema,
  BrowserbaseSearchOptionsSchema,
  BrowserbaseSearchResultSchema,
  ClientLLMSchema,
  LocalBrowserConnectOptionsSchema,
  LocalBrowserLaunchOptionsSchema,
  StagehandClientLogFormatSchema,
  StagehandClientLoggingConfigSchema,
  StagehandClientLogLevelSchema,
  StagehandClientCreateConfigSchema,
  StagehandBrowserSchema,
  StagehandCreateOptionsSchema,
  WebMCPInvokeOptionsSchema,
  WebMCPResultOptionsSchema,
  WebMCPToolsOptionsSchema,
  type ClientLLM,
  type ResolvedStagehandClientLoggingConfig,
  type StagehandClientActOptions,
  type StagehandClientExtractOptions,
  type StagehandClientLoggingConfig,
  type StagehandClientObserveOptions,
  type StagehandClientCreateConfig,
  type StagehandCreateOptions,
  type ResolvedStagehandCreateOptions,
  type WebMCPInvokeOptions,
  type WebMCPResultOptions,
  type WebMCPToolsOptions,
} from "./clientSchemas.js";

export { getExtensionArchive } from "./extensionAssets.js";
