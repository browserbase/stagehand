import { describe, expectTypeOf, it } from "vite-plus/test";
import * as Stagehand from "../../../server/types/public/index.js";

export const publicErrorTypes = {
  CdpConnectionClosedError: Stagehand.CdpConnectionClosedError,
  BrowserbaseSessionNotFoundError: Stagehand.BrowserbaseSessionNotFoundError,
  CaptchaTimeoutError: Stagehand.CaptchaTimeoutError,
  ConnectionTimeoutError: Stagehand.ConnectionTimeoutError,
  ContentFrameNotFoundError: Stagehand.ContentFrameNotFoundError,
  CookieSetError: Stagehand.CookieSetError,
  CookieValidationError: Stagehand.CookieValidationError,
  CreateChatCompletionResponseError: Stagehand.CreateChatCompletionResponseError,
  ElementNotVisibleError: Stagehand.ElementNotVisibleError,
  ExperimentalApiConflictError: Stagehand.ExperimentalApiConflictError,
  ExperimentalNotConfiguredError: Stagehand.ExperimentalNotConfiguredError,
  HandlerNotInitializedError: Stagehand.HandlerNotInitializedError,
  InvalidAISDKModelFormatError: Stagehand.InvalidAISDKModelFormatError,
  LLMResponseError: Stagehand.LLMResponseError,
  MissingLLMConfigurationError: Stagehand.MissingLLMConfigurationError,
  PageNotFoundError: Stagehand.PageNotFoundError,
  ResponseBodyError: Stagehand.ResponseBodyError,
  ResponseParseError: Stagehand.ResponseParseError,
  StagehandClickError: Stagehand.StagehandClickError,
  StagehandClosedError: Stagehand.StagehandClosedError,
  StagehandDefaultError: Stagehand.StagehandDefaultError,
  StagehandDomProcessError: Stagehand.StagehandDomProcessError,
  StagehandElementNotFoundError: Stagehand.StagehandElementNotFoundError,
  StagehandEnvironmentError: Stagehand.StagehandEnvironmentError,
  StagehandError: Stagehand.StagehandError,
  StagehandEvalError: Stagehand.StagehandEvalError,
  StagehandIframeError: Stagehand.StagehandIframeError,
  StagehandInitError: Stagehand.StagehandInitError,
  StagehandInvalidArgumentError: Stagehand.StagehandInvalidArgumentError,
  StagehandLocatorError: Stagehand.StagehandLocatorError,
  StagehandMissingArgumentError: Stagehand.StagehandMissingArgumentError,
  StagehandNotInitializedError: Stagehand.StagehandNotInitializedError,
  StagehandShadowRootMissingError: Stagehand.StagehandShadowRootMissingError,
  StagehandShadowSegmentEmptyError: Stagehand.StagehandShadowSegmentEmptyError,
  StagehandShadowSegmentNotFoundError: Stagehand.StagehandShadowSegmentNotFoundError,
  StagehandSnapshotError: Stagehand.StagehandSnapshotError,
  StagehandUnsupportedBrowserFeatureError: Stagehand.StagehandUnsupportedBrowserFeatureError,
  TimeoutError: Stagehand.TimeoutError,
  UnsupportedAISDKModelProviderError: Stagehand.UnsupportedAISDKModelProviderError,
  UnsupportedModelError: Stagehand.UnsupportedModelError,
  UnsupportedModelProviderError: Stagehand.UnsupportedModelProviderError,
  XPathResolutionError: Stagehand.XPathResolutionError,
  ZodSchemaValidationError: Stagehand.ZodSchemaValidationError,
  ActTimeoutError: Stagehand.ActTimeoutError,
  ObserveTimeoutError: Stagehand.ObserveTimeoutError,
  ExtractTimeoutError: Stagehand.ExtractTimeoutError,
  UnderstudyCommandException: Stagehand.UnderstudyCommandException,
  StagehandSetExtraHTTPHeadersError: Stagehand.StagehandSetExtraHTTPHeadersError,
  StagehandSetDomainPolicyError: Stagehand.StagehandSetDomainPolicyError,
} as const;

const errorTypes = Object.keys(publicErrorTypes) as Array<keyof typeof publicErrorTypes>;

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
