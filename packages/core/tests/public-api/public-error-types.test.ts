import { describe, expectTypeOf, it } from "vitest";
import * as Stagehand from "../../dist";

export const publicErrorTypes = {
  AgentScreenshotProviderError: Stagehand.AgentScreenshotProviderError,
  BrowserbaseSessionNotFoundError: Stagehand.BrowserbaseSessionNotFoundError,
  CaptchaTimeoutError: Stagehand.CaptchaTimeoutError,
  ConnectionTimeoutError: Stagehand.ConnectionTimeoutError,
  ContentFrameNotFoundError: Stagehand.ContentFrameNotFoundError,
  CreateChatCompletionResponseError:
    Stagehand.CreateChatCompletionResponseError,
  CuaModelRequiredError: Stagehand.CuaModelRequiredError,
  ElementNotVisibleError: Stagehand.ElementNotVisibleError,
  ExperimentalApiConflictError: Stagehand.ExperimentalApiConflictError,
  ExperimentalNotConfiguredError: Stagehand.ExperimentalNotConfiguredError,
  HandlerNotInitializedError: Stagehand.HandlerNotInitializedError,
  InvalidAISDKModelFormatError: Stagehand.InvalidAISDKModelFormatError,
  LLMResponseError: Stagehand.LLMResponseError,
  MCPConnectionError: Stagehand.MCPConnectionError,
  MissingEnvironmentVariableError: Stagehand.MissingEnvironmentVariableError,
  MissingLLMConfigurationError: Stagehand.MissingLLMConfigurationError,
  PageNotFoundError: Stagehand.PageNotFoundError,
  ResponseBodyError: Stagehand.ResponseBodyError,
  ResponseParseError: Stagehand.ResponseParseError,
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
  XPathResolutionError: Stagehand.XPathResolutionError,
  ZodSchemaValidationError: Stagehand.ZodSchemaValidationError,
} as const;

const errorTypes = Object.keys(publicErrorTypes) as Array<
  keyof typeof publicErrorTypes
>;

describe("Stagehand public error types", () => {
  describe("errors", () => {
    it.each(errorTypes)("%s extends Error", (errorTypeName) => {
      const ErrorClass = Stagehand[errorTypeName];
      type ErrorClassType = typeof ErrorClass;
      expectTypeOf<InstanceType<ErrorClassType>>().toExtend<Error>();
      void ErrorClass; // Mark as used to satisfy ESLint
    });
  });
});
