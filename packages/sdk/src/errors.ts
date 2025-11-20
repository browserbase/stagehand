export class StagehandError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "StagehandError";
  }
}

function defineStagehandError(name: string) {
  return class extends StagehandError {
    constructor(message?: string) {
      super(message);
      this.name = name;
    }
  };
}

export class AgentScreenshotProviderError extends StagehandError {}
export class BrowserbaseSessionNotFoundError extends StagehandError {}
export class CaptchaTimeoutError extends StagehandError {}
export class ConnectionTimeoutError extends StagehandError {}
export class ContentFrameNotFoundError extends StagehandError {}
export class CreateChatCompletionResponseError extends StagehandError {}
export class CuaModelRequiredError extends StagehandError {}
export class ElementNotVisibleError extends StagehandError {}
export class ExperimentalApiConflictError extends StagehandError {}
export class ExperimentalNotConfiguredError extends StagehandError {}
export class HandlerNotInitializedError extends StagehandError {}
export class InvalidAISDKModelFormatError extends StagehandError {}
export class LLMResponseError extends StagehandError {}
export class MCPConnectionError extends StagehandError {}
export class MissingEnvironmentVariableError extends StagehandError {}
export class MissingLLMConfigurationError extends StagehandError {}
export class PageNotFoundError extends StagehandError {}
export class ResponseBodyError extends StagehandError {}
export class ResponseParseError extends StagehandError {}
export class StagehandAPIError extends StagehandError {}
export class StagehandAPIUnauthorizedError extends StagehandError {}
export class StagehandClickError extends StagehandError {}
export class StagehandDefaultError extends StagehandError {}
export class StagehandDomProcessError extends StagehandError {}
export class StagehandElementNotFoundError extends StagehandError {}
export class StagehandEnvironmentError extends StagehandError {}
export class StagehandEvalError extends StagehandError {}
export class StagehandHttpError extends StagehandError {}
export class StagehandIframeError extends StagehandError {}
export class StagehandInitError extends StagehandError {}
export class StagehandInvalidArgumentError extends StagehandError {}
export class StagehandMissingArgumentError extends StagehandError {}
export class StagehandNotInitializedError extends StagehandError {}
export class StagehandResponseBodyError extends StagehandError {}
export class StagehandResponseParseError extends StagehandError {}
export class StagehandServerError extends StagehandError {}
export class StagehandShadowRootMissingError extends StagehandError {}
export class StagehandShadowSegmentEmptyError extends StagehandError {}
export class StagehandShadowSegmentNotFoundError extends StagehandError {}
export class TimeoutError extends StagehandError {}
export class UnsupportedAISDKModelProviderError extends StagehandError {}
export class UnsupportedModelError extends StagehandError {}
export class UnsupportedModelProviderError extends StagehandError {}
export class XPathResolutionError extends StagehandError {}
export class ZodSchemaValidationError extends StagehandError {}
