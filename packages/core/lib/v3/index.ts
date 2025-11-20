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

export * from "./publicTypes";
