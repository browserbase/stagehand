export { V3 } from "./v3";
export { V3 as Stagehand } from "./v3";

export { AnnotatedScreenshotText, LLMClient } from "./llm/LLMClient";

export { AVAILABLE_CUA_MODELS } from "./types/public/agent";
export {
  defaultExtractSchema,
  pageTextSchema,
  V3FunctionName,
} from "./types/public/methods";
export { LOG_LEVEL_NAMES } from "./types/public/logs";
export { ConsoleMessage, Response } from "./types/public/page";
export { AISdkClient } from "./types/public";

export {
  StagehandAPIError,
  StagehandAPIUnauthorizedError,
  StagehandHttpError,
  StagehandServerError,
  StagehandResponseBodyError,
  StagehandResponseParseError,
} from "./types/public/apiErrors";

export {
  StagehandError,
  StagehandDefaultError,
  StagehandEnvironmentError,
  MissingEnvironmentVariableError,
  UnsupportedModelError,
  UnsupportedModelProviderError,
  UnsupportedAISDKModelProviderError,
  InvalidAISDKModelFormatError,
  StagehandNotInitializedError,
  BrowserbaseSessionNotFoundError,
  CaptchaTimeoutError,
  MissingLLMConfigurationError,
  HandlerNotInitializedError,
  StagehandInvalidArgumentError,
  StagehandElementNotFoundError,
  AgentScreenshotProviderError,
  StagehandMissingArgumentError,
  CreateChatCompletionResponseError,
  StagehandEvalError,
  StagehandDomProcessError,
  StagehandClickError,
  LLMResponseError,
  StagehandIframeError,
  ContentFrameNotFoundError,
  XPathResolutionError,
  ExperimentalApiConflictError,
  ExperimentalNotConfiguredError,
  CuaModelRequiredError,
  ZodSchemaValidationError,
  StagehandInitError,
  MCPConnectionError,
  StagehandShadowRootMissingError,
  StagehandShadowSegmentEmptyError,
  StagehandShadowSegmentNotFoundError,
  ElementNotVisibleError,
  ResponseBodyError,
  ResponseParseError,
  TimeoutError,
  PageNotFoundError,
  ConnectionTimeoutError,
} from "./types/public/sdkErrors";

export { AgentProvider, modelToAgentProviderMap } from "./agent/AgentProvider";

export {
  validateZodSchema,
  isRunningInBun,
  toGeminiSchema,
  getZodType,
  transformSchema,
  injectUrls,
  providerEnvVarMap,
  loadApiKeyFromEnv,
  trimTrailingTextNode,
  jsonSchemaToZod,
} from "../utils";
export { isZod4Schema, isZod3Schema, toJsonSchema } from "./zodCompat";

export { connectToMCPServer } from "./mcp/connection";
export { V3Evaluator } from "../v3Evaluator";

export type {
  AnthropicJsonSchemaObject,
  AISDKProvider,
  AISDKCustomProvider,
  LLMTool,
  AvailableModel,
  ModelProvider,
  ClientOptions,
  ModelConfiguration,
} from "./types/public/model";

export type {
  ActOptions,
  ActResult,
  ExtractResult,
  Action,
  HistoryEntry,
  ExtractOptions,
  ObserveOptions,
} from "./types/public/methods";

export type {
  AgentAction,
  AgentResult,
  AgentExecuteOptions,
  AgentType,
  AgentExecutionOptions,
  AgentHandlerOptions,
  ActionExecutionResult,
  ToolUseItem,
  AnthropicMessage,
  AnthropicContentBlock,
  AnthropicTextBlock,
  AnthropicToolResult,
  ResponseItem,
  ComputerCallItem,
  FunctionCallItem,
  ResponseInputItem,
  AgentInstance,
  AgentProviderType,
  AgentModelConfig,
  AgentConfig,
  AvailableCuaModel,
} from "./types/public/agent";

export type { LogLevel, LogLine, Logger } from "./types/public/logs";
export type { StagehandMetrics } from "./types/public/metrics";
export type {
  V3Env,
  LocalBrowserLaunchOptions,
  V3Options,
} from "./types/public/options";
export type {
  PlaywrightPage,
  PatchrightPage,
  PuppeteerPage,
  Page,
  AnyPage,
  ConsoleListener,
  LoadState,
} from "./types/public/page";

export type {
  ChatMessage,
  ChatMessageContent,
  ChatMessageImageContent,
  ChatMessageTextContent,
  ChatCompletionOptions,
  LLMResponse,
  CreateChatCompletionOptions,
  LLMUsage,
  LLMParsedResponse,
} from "./llm/LLMClient";

export type {
  StagehandZodSchema,
  StagehandZodObject,
  InferStagehandSchema,
  JsonSchemaDocument,
} from "./zodCompat";

export type { JsonSchema, JsonSchemaProperty } from "../utils";
