import { describe, expect, expectTypeOf, it } from "vitest";
import StagehandDefaultExport, * as Stagehand from "../dist/index.js";

const publicApiShape = {
  AISdkClient: Stagehand.AISdkClient,
  AVAILABLE_CUA_MODELS: Stagehand.AVAILABLE_CUA_MODELS,
  AgentProvider: Stagehand.AgentProvider,
  AgentScreenshotProviderError: Stagehand.AgentScreenshotProviderError,
  AnnotatedScreenshotText: Stagehand.AnnotatedScreenshotText,
  BrowserbaseSessionNotFoundError: Stagehand.BrowserbaseSessionNotFoundError,
  CaptchaTimeoutError: Stagehand.CaptchaTimeoutError,
  ConnectionTimeoutError: Stagehand.ConnectionTimeoutError,
  ConsoleMessage: Stagehand.ConsoleMessage,
  ContentFrameNotFoundError: Stagehand.ContentFrameNotFoundError,
  CreateChatCompletionResponseError:
    Stagehand.CreateChatCompletionResponseError,
  CuaModelRequiredError: Stagehand.CuaModelRequiredError,
  ElementNotVisibleError: Stagehand.ElementNotVisibleError,
  ExperimentalApiConflictError: Stagehand.ExperimentalApiConflictError,
  ExperimentalNotConfiguredError: Stagehand.ExperimentalNotConfiguredError,
  HandlerNotInitializedError: Stagehand.HandlerNotInitializedError,
  InvalidAISDKModelFormatError: Stagehand.InvalidAISDKModelFormatError,
  LLMClient: Stagehand.LLMClient,
  LLMResponseError: Stagehand.LLMResponseError,
  LOG_LEVEL_NAMES: Stagehand.LOG_LEVEL_NAMES,
  MCPConnectionError: Stagehand.MCPConnectionError,
  MissingEnvironmentVariableError: Stagehand.MissingEnvironmentVariableError,
  MissingLLMConfigurationError: Stagehand.MissingLLMConfigurationError,
  PageNotFoundError: Stagehand.PageNotFoundError,
  Response: Stagehand.Response,
  ResponseBodyError: Stagehand.ResponseBodyError,
  ResponseParseError: Stagehand.ResponseParseError,
  Stagehand: Stagehand.Stagehand,
  StagehandAPIError: Stagehand.StagehandAPIError,
  StagehandAPIUnauthorizedError: Stagehand.StagehandAPIUnauthorizedError,
  StagehandClickError: Stagehand.StagehandClickError,
  StagehandDefaultError: Stagehand.StagehandDefaultError,
  StagehandDomProcessError: Stagehand.StagehandDomProcessError,
  StagehandElementNotFoundError: Stagehand.StagehandElementNotFoundError,
  StagehandEnvironmentError: Stagehand.StagehandEnvironmentError,
  StagehandError: Stagehand.StagehandError,
  StagehandEvalError: Stagehand.StagehandEvalError,
  StagehandHttpError: Stagehand.StagehandHttpError,
  StagehandIframeError: Stagehand.StagehandIframeError,
  StagehandInitError: Stagehand.StagehandInitError,
  StagehandInvalidArgumentError: Stagehand.StagehandInvalidArgumentError,
  StagehandMissingArgumentError: Stagehand.StagehandMissingArgumentError,
  StagehandNotInitializedError: Stagehand.StagehandNotInitializedError,
  StagehandResponseBodyError: Stagehand.StagehandResponseBodyError,
  StagehandResponseParseError: Stagehand.StagehandResponseParseError,
  StagehandServerError: Stagehand.StagehandServerError,
  StagehandShadowRootMissingError: Stagehand.StagehandShadowRootMissingError,
  StagehandShadowSegmentEmptyError: Stagehand.StagehandShadowSegmentEmptyError,
  StagehandShadowSegmentNotFoundError:
    Stagehand.StagehandShadowSegmentNotFoundError,
  TimeoutError: Stagehand.TimeoutError,
  UnsupportedAISDKModelProviderError:
    Stagehand.UnsupportedAISDKModelProviderError,
  UnsupportedModelError: Stagehand.UnsupportedModelError,
  UnsupportedModelProviderError: Stagehand.UnsupportedModelProviderError,
  V3: Stagehand.V3,
  V3Evaluator: Stagehand.V3Evaluator,
  V3FunctionName: Stagehand.V3FunctionName,
  XPathResolutionError: Stagehand.XPathResolutionError,
  ZodSchemaValidationError: Stagehand.ZodSchemaValidationError,
  connectToMCPServer: Stagehand.connectToMCPServer,
  default: StagehandDefaultExport,
  defaultExtractSchema: Stagehand.defaultExtractSchema,
  getZodType: Stagehand.getZodType,
  injectUrls: Stagehand.injectUrls,
  isRunningInBun: Stagehand.isRunningInBun,
  jsonSchemaToZod: Stagehand.jsonSchemaToZod,
  loadApiKeyFromEnv: Stagehand.loadApiKeyFromEnv,
  modelToAgentProviderMap: Stagehand.modelToAgentProviderMap,
  pageTextSchema: Stagehand.pageTextSchema,
  providerEnvVarMap: Stagehand.providerEnvVarMap,
  toGeminiSchema: Stagehand.toGeminiSchema,
  transformSchema: Stagehand.transformSchema,
  trimTrailingTextNode: Stagehand.trimTrailingTextNode,
  validateZodSchema: Stagehand.validateZodSchema,
} as const;

type StagehandExports = typeof Stagehand & {
  default: typeof StagehandDefaultExport;
};

type PublicAPI = {
  [K in keyof typeof publicApiShape]: StagehandExports[K];
};

describe("Stagehand public API types", () => {
  it("public API shape matches module exports", () => {
    const _check: PublicAPI = publicApiShape;
    void _check;
  });

  it("does not expose unexpected top-level exports", () => {
    const expected = Object.keys(publicApiShape).sort();
    const actual = Object.keys(Stagehand).sort();
    expect(actual).toStrictEqual(expected);
  });

  it("StagehandMetrics includes token counters", () => {
    expectTypeOf<Stagehand.StagehandMetrics>().toEqualTypeOf<{
      actPromptTokens: number;
      actCompletionTokens: number;
      actReasoningTokens: number;
      actCachedInputTokens: number;
      actInferenceTimeMs: number;
      extractPromptTokens: number;
      extractCompletionTokens: number;
      extractReasoningTokens: number;
      extractCachedInputTokens: number;
      extractInferenceTimeMs: number;
      observePromptTokens: number;
      observeCompletionTokens: number;
      observeReasoningTokens: number;
      observeCachedInputTokens: number;
      observeInferenceTimeMs: number;
      agentPromptTokens: number;
      agentCompletionTokens: number;
      agentReasoningTokens: number;
      agentCachedInputTokens: number;
      agentInferenceTimeMs: number;
      totalPromptTokens: number;
      totalCompletionTokens: number;
      totalReasoningTokens: number;
      totalCachedInputTokens: number;
      totalInferenceTimeMs: number;
    }>();
  });
});
