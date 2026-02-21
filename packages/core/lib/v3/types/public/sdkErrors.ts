import { ZodError } from "zod";
// Avoid .js extension so bundlers resolve TS source
import { STAGEHAND_VERSION } from "../../../version.js";

export class StagehandError extends Error {
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export class StagehandDefaultError extends StagehandError {
  constructor(error?: unknown) {
    if (error instanceof Error || error instanceof StagehandError) {
      super(
        `\nHey! We're sorry you ran into an error. \nStagehand version: ${STAGEHAND_VERSION} \nIf you need help, please open a Github issue or reach out to us on Discord: https://stagehand.dev/discord\n\nFull error:\n${error.message}`,
      );
    }
  }
}

export class StagehandEnvironmentError extends StagehandError {
  constructor(
    currentEnvironment: string,
    requiredEnvironment: string,
    feature: string,
  ) {
    super(
      `You seem to be setting the current environment to ${currentEnvironment}.` +
        `Ensure the environment is set to ${requiredEnvironment} if you want to use ${feature}.`,
    );
  }
}

export class MissingEnvironmentVariableError extends StagehandError {
  constructor(missingEnvironmentVariable: string, feature: string) {
    super(
      `${missingEnvironmentVariable} is required to use ${feature}.` +
        `Please set ${missingEnvironmentVariable} in your environment.`,
    );
  }
}

export class UnsupportedModelError extends StagehandError {
  constructor(supportedModels: string[], feature?: string) {
    const message = feature
      ? `${feature} requires a valid model.`
      : `Unsupported model.`;

    const guidance =
      `\n\nPlease use the provider/model format (e.g., "openai/gpt-4o", "anthropic/claude-sonnet-4-5", "google/gemini-3-flash-preview").` +
      `\n\nFor a complete list of supported models and providers, see: https://docs.stagehand.dev/v3/configuration/models#configuration-setup`;

    super(`${message}${guidance}`);
  }
}

export class UnsupportedModelProviderError extends StagehandError {
  constructor(supportedProviders: string[], feature?: string) {
    super(
      feature
        ? `${feature} requires one of the following model providers: ${supportedProviders}`
        : `please use one of the supported model providers: ${supportedProviders}`,
    );
  }
}

export class UnsupportedAISDKModelProviderError extends StagehandError {
  constructor(provider: string, supportedProviders: string[]) {
    super(
      `${provider} is not currently supported for aiSDK. please use one of the supported model providers: ${supportedProviders}`,
    );
  }
}

export class InvalidAISDKModelFormatError extends StagehandError {
  constructor(modelName: string) {
    super(
      `${modelName} does not follow correct format for specifying aiSDK models. Please define your model as 'provider/model-name'. For example: \`model: 'openai/gpt-4o-mini'\``,
    );
  }
}

export class StagehandNotInitializedError extends StagehandError {
  constructor(prop: string) {
    super(
      `You seem to be calling \`${prop}\` on a page in an uninitialized \`Stagehand\` object. ` +
        `Ensure you are running \`await stagehand.init()\` on the Stagehand object before ` +
        `referencing the \`page\` object.`,
    );
  }
}

export class BrowserbaseSessionNotFoundError extends StagehandError {
  constructor() {
    super("No Browserbase session ID found");
  }
}

export class CaptchaTimeoutError extends StagehandError {
  constructor() {
    super("Captcha timeout");
  }
}

export class MissingLLMConfigurationError extends StagehandError {
  constructor() {
    super(
      "No LLM API key or LLM Client configured. An LLM API key or a custom LLM Client " +
        "is required to use act, extract, or observe.",
    );
  }
}

export class HandlerNotInitializedError extends StagehandError {
  constructor(handlerType: string) {
    super(`${handlerType} handler not initialized`);
  }
}

export class StagehandInvalidArgumentError extends StagehandError {
  constructor(message: string) {
    super(`InvalidArgumentError: ${message}`);
  }
}

export class CookieValidationError extends StagehandError {
  constructor(message: string) {
    super(message);
  }
}

export class CookieSetError extends StagehandError {
  constructor(message: string) {
    super(message);
  }
}

export class StagehandElementNotFoundError extends StagehandError {
  constructor(xpaths: string[]) {
    super(`Could not find an element for the given xPath(s): ${xpaths}`);
  }
}

export class AgentScreenshotProviderError extends StagehandError {
  constructor(message: string) {
    super(`ScreenshotProviderError: ${message}`);
  }
}

export class StagehandMissingArgumentError extends StagehandError {
  constructor(message: string) {
    super(`MissingArgumentError: ${message}`);
  }
}

export class CreateChatCompletionResponseError extends StagehandError {
  constructor(message: string) {
    super(`CreateChatCompletionResponseError: ${message}`);
  }
}

export class StagehandEvalError extends StagehandError {
  constructor(message: string) {
    super(`StagehandEvalError: ${message}`);
  }
}

export class StagehandDomProcessError extends StagehandError {
  constructor(message: string) {
    super(`Error Processing Dom: ${message}`);
  }
}

export class StagehandLocatorError extends StagehandError {
  constructor(action: string, selector: string, message: string) {
    super(
      `Error ${action} Element with selector: ${selector} Reason: ${message}`,
    );
  }
}

export class StagehandClickError extends StagehandError {
  constructor(message: string, selector: string) {
    super(
      `Error Clicking Element with selector: ${selector} Reason: ${message}`,
    );
  }
}

export class LLMResponseError extends StagehandError {
  constructor(primitive: string, message: string) {
    super(`${primitive} LLM response error: ${message}`);
  }
}

export class StagehandIframeError extends StagehandError {
  constructor(frameUrl: string, message: string) {
    super(
      `Unable to resolve frameId for iframe with URL: ${frameUrl} Full error: ${message}`,
    );
  }
}

export class ContentFrameNotFoundError extends StagehandError {
  constructor(selector: string) {
    super(`Unable to obtain a content frame for selector: ${selector}`);
  }
}

export class XPathResolutionError extends StagehandError {
  constructor(xpath: string) {
    super(`XPath "${xpath}" does not resolve in the current page or frames`);
  }
}

export class ExperimentalApiConflictError extends StagehandError {
  constructor() {
    super(
      "`experimental` mode cannot be used together with the Stagehand API. " +
        "To use experimental features, set experimental: true and disableAPI: true in the stagehand constructor. " +
        "To use the Stagehand API, set experimental: false and disableAPI: false (or omit it) in the stagehand constructor.",
    );
  }
}

export class ExperimentalNotConfiguredError extends StagehandError {
  constructor(featureName: string) {
    super(`Feature "${featureName}" is an experimental feature, and cannot be configured when disableAPI: false.
    Please set experimental: true and disableAPI: true in the stagehand constructor to use this feature.
    If you wish to use the Stagehand API, please ensure ${featureName} is not defined in your function call,
    and set experimental: false, disableAPI: false (or omit it) in the Stagehand constructor.`);
  }
}

export class CuaModelRequiredError extends StagehandError {
  constructor(availableModels: readonly string[]) {
    super(
      `To use the computer use agent (CUA), please provide a CUA model in the agent constructor or stagehand config. ` +
        `Try one of our supported CUA models: ${availableModels.join(", ")}`,
    );
  }
}

export class ZodSchemaValidationError extends Error {
  constructor(
    public readonly received: unknown,
    public readonly issues: ReturnType<ZodError["format"]>,
  ) {
    super(`Zod schema validation failed

— Received —
${JSON.stringify(received, null, 2)}

— Issues —
${JSON.stringify(issues, null, 2)}`);
    this.name = "ZodSchemaValidationError";
  }
}

export class StagehandInitError extends StagehandError {
  constructor(message: string) {
    super(message);
  }
}

export class MCPConnectionError extends StagehandError {
  public readonly serverUrl: string;
  public readonly originalError: unknown;

  constructor(serverUrl: string, originalError: unknown) {
    const errorMessage =
      originalError instanceof Error
        ? originalError.message
        : String(originalError);

    super(
      `Failed to connect to MCP server at "${serverUrl}". ${errorMessage}. ` +
        `Please verify the server URL is correct and the server is running.`,
    );

    this.serverUrl = serverUrl;
    this.originalError = originalError;
  }
}

export class StagehandShadowRootMissingError extends StagehandError {
  constructor(detail?: string) {
    super(
      `No shadow root present on the resolved host` +
        (detail ? `: ${detail}` : ""),
    );
  }
}

export class StagehandShadowSegmentEmptyError extends StagehandError {
  constructor() {
    super(`Empty selector segment after shadow-DOM hop ("//")`);
  }
}

export class StagehandShadowSegmentNotFoundError extends StagehandError {
  constructor(segment: string, hint?: string) {
    super(
      `Shadow segment '${segment}' matched no element inside shadow root` +
        (hint ? ` ${hint}` : ""),
    );
  }
}

export class ElementNotVisibleError extends StagehandError {
  constructor(selector: string) {
    super(`Element not visible (no box model): ${selector}`);
  }
}

export class ResponseBodyError extends StagehandError {
  constructor(message: string) {
    super(`Failed to retrieve response body: ${message}`);
  }
}

export class ResponseParseError extends StagehandError {
  constructor(message: string) {
    super(`Failed to parse response: ${message}`);
  }
}

export class TimeoutError extends StagehandError {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`);
  }
}

export class ActTimeoutError extends TimeoutError {
  constructor(timeoutMs: number) {
    super("act()", timeoutMs);
    this.name = "ActTimeoutError";
  }
}

export class ExtractTimeoutError extends TimeoutError {
  constructor(timeoutMs: number) {
    super("extract()", timeoutMs);
    this.name = "ExtractTimeoutError";
  }
}

export class ObserveTimeoutError extends TimeoutError {
  constructor(timeoutMs: number) {
    super("observe()", timeoutMs);
    this.name = "ObserveTimeoutError";
  }
}

export class PageNotFoundError extends StagehandError {
  constructor(identifier: string) {
    super(`No Page found for ${identifier}`);
  }
}

export class ConnectionTimeoutError extends StagehandError {
  constructor(message: string) {
    super(`Connection timeout: ${message}`);
  }
}

export class StreamingCallbacksInNonStreamingModeError extends StagehandError {
  public readonly invalidCallbacks: string[];

  constructor(invalidCallbacks: string[]) {
    super(
      `Streaming-only callback(s) "${invalidCallbacks.join('", "')}" cannot be used in non-streaming mode. ` +
        `Set 'stream: true' in AgentConfig to use these callbacks.`,
    );
    this.invalidCallbacks = invalidCallbacks;
  }
}

export class AgentAbortError extends StagehandError {
  public readonly reason: string;

  constructor(reason?: string) {
    const message = reason
      ? `Agent execution was aborted: ${reason}`
      : "Agent execution was aborted";
    super(message);
    this.reason = reason || "aborted";
  }
}

export class StagehandClosedError extends StagehandError {
  constructor() {
    super("Stagehand session was closed");
  }
}

export class CdpConnectionClosedError extends StagehandError {
  constructor(reason: string) {
    super(`CDP connection closed: ${reason}`);
  }
}

export class StagehandSetExtraHTTPHeadersError extends StagehandError {
  public readonly failures: string[];

  constructor(failures: string[]) {
    super(
      `setExtraHTTPHeaders failed for ${failures.length} session(s): ${failures.join(", ")}`,
    );
    this.failures = failures;
  }
}

export class StagehandSnapshotError extends StagehandError {
  constructor(cause?: unknown) {
    const suffix =
      cause instanceof Error
        ? `: ${cause.message}`
        : cause
          ? `: ${String(cause)}`
          : "";
    super(`error taking snapshot${suffix}`, cause);
  }
}

export class UnderstudyCommandException extends StagehandError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "UnderstudyCommandException";
  }
}
