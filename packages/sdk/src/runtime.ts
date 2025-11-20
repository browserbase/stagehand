import type {
  ActOptions,
  ActResult,
  Action,
  AgentAction,
  AgentConfig,
  AgentExecuteOptions,
  AgentExecutionOptions,
  AgentProviderType,
  AgentReplayStep,
  AgentResult,
  AgentType,
  AnyPage,
  ClientOptions,
  ConnectToMCPServerOptions,
  ConsoleListener,
  ExtractOptions,
  HistoryEntry,
  JsonSchema,
  JsonSchemaDocument,
  JsonSchemaProperty,
  LoadState,
  LogLevel,
  LogLine,
  Logger,
  MCPClient,
  ModelConfiguration,
  ObserveOptions,
  StagehandMetrics,
  StdioServerConfig,
  ToolUseItem,
  V3Env,
  V3FunctionName,
  V3Options,
  AISDKCustomProvider,
  AISDKProvider,
  ChatCompletionOptions,
  CreateChatCompletionOptions,
  LLMResponse,
  LLMUsage, AgentClient,
} from "./types";
import {
  AnnotatedScreenshotText,
  AVAILABLE_CUA_MODELS,
  LOG_LEVEL_NAMES,
  defaultExtractSchema,
  getZodType,
  injectUrls,
  isRunningInBun,
  isZod3Schema,
  isZod4Schema,
  jsonSchemaToZod,
  loadApiKeyFromEnv,
  modelToAgentProviderMap,
  pageTextSchema,
  providerEnvVarMap,
  toGeminiSchema,
  toJsonSchema,
  transformSchema,
  trimTrailingTextNode,
  validateZodSchema,
} from "./constants";
import {
  AgentScreenshotProviderError,
  BrowserbaseSessionNotFoundError,
  CaptchaTimeoutError,
  ConnectionTimeoutError,
  ContentFrameNotFoundError,
  CreateChatCompletionResponseError,
  CuaModelRequiredError,
  ElementNotVisibleError,
  ExperimentalApiConflictError,
  ExperimentalNotConfiguredError,
  HandlerNotInitializedError,
  InvalidAISDKModelFormatError,
  LLMResponseError,
  MCPConnectionError,
  MissingEnvironmentVariableError,
  MissingLLMConfigurationError,
  PageNotFoundError,
  ResponseBodyError,
  ResponseParseError,
  StagehandAPIError,
  StagehandAPIUnauthorizedError,
  StagehandClickError,
  StagehandDefaultError,
  StagehandDomProcessError,
  StagehandElementNotFoundError,
  StagehandEnvironmentError,
  StagehandError,
  StagehandEvalError,
  StagehandHttpError,
  StagehandIframeError,
  StagehandInitError,
  StagehandInvalidArgumentError,
  StagehandMissingArgumentError,
  StagehandNotInitializedError,
  StagehandResponseBodyError,
  StagehandResponseParseError,
  StagehandServerError,
  StagehandShadowRootMissingError,
  StagehandShadowSegmentEmptyError,
  StagehandShadowSegmentNotFoundError,
  TimeoutError,
  UnsupportedAISDKModelProviderError,
  UnsupportedModelError,
  UnsupportedModelProviderError,
  XPathResolutionError,
  ZodSchemaValidationError,
} from "./errors";
import { V3FunctionName as V3Fn } from "./types";

class StagehandSDKNotImplementedError extends Error {
  constructor(method: string) {
    super(`Stagehand SDK stub: ${method} is not implemented yet.`);
    this.name = "StagehandSDKNotImplementedError";
  }
}

const rejectNotImplemented = <T = never>(method: string): Promise<T> =>
  Promise.reject(new StagehandSDKNotImplementedError(method));

const notImplemented = (method: string): never => {
  throw new StagehandSDKNotImplementedError(method);
};

export class ConsoleMessage {
  constructor(
    public readonly type: string,
    public readonly message: string,
    public readonly args: unknown[] = [],
    public readonly location: Record<string, unknown> = {},
  ) {}

  text(): string {
    return this.message;
  }

  argumentValues(): unknown[] {
    return this.args;
  }
}

export class Response {
  url(): string {
    return notImplemented("Response.url");
  }
  status(): number {
    return notImplemented("Response.status");
  }
  statusText(): string {
    return notImplemented("Response.statusText");
  }
  headers(): Record<string, string> {
    return notImplemented("Response.headers");
  }
  headersArray(): Array<{ name: string; value: string }> {
    return notImplemented("Response.headersArray");
  }
  allHeaders(): Promise<Record<string, string>> {
    return rejectNotImplemented("Response.allHeaders");
  }
  headerValue(_name: string): string | null {
    return notImplemented("Response.headerValue");
  }
  headerValues(_name: string): string[] {
    return notImplemented("Response.headerValues");
  }
  finished(): boolean {
    return false;
  }
  markFinished(): void {}
  applyExtraInfo(_info: unknown): void {}
  fromServiceWorker(): boolean {
    return false;
  }
  frame(): unknown {
    return null;
  }
  ok(): boolean {
    return false;
  }
  securityDetails(): unknown {
    return null;
  }
  serverAddr(): unknown {
    return null;
  }
  body(): Promise<Buffer> {
    return rejectNotImplemented("Response.body");
  }
  text(): Promise<string> {
    return rejectNotImplemented("Response.text");
  }
  json<T = unknown>(): Promise<T> {
    return rejectNotImplemented("Response.json");
  }
}

export abstract class LLMClient {
  public type: string = "sdk";
  public modelName: string;
  public hasVision = false;
  public clientOptions: ClientOptions = {};
  public userProvidedInstructions?: string;

  constructor(modelName: string, userProvidedInstructions?: string) {
    this.modelName = modelName;
    this.userProvidedInstructions = userProvidedInstructions;
  }

  generateText = (..._args: unknown[]): Promise<unknown> =>
    rejectNotImplemented("LLMClient.generateText");
  generateObject = (..._args: unknown[]): Promise<unknown> =>
    rejectNotImplemented("LLMClient.generateObject");
  streamText = (..._args: unknown[]): AsyncIterable<unknown> =>
    (async function* () {
      throw new StagehandSDKNotImplementedError("LLMClient.streamText");
    })();
  streamObject = (..._args: unknown[]): AsyncIterable<unknown> =>
    (async function* () {
      throw new StagehandSDKNotImplementedError("LLMClient.streamObject");
    })();
  generateImage = (..._args: unknown[]): Promise<unknown> =>
    rejectNotImplemented("LLMClient.generateImage");
  embed = (..._args: unknown[]): Promise<unknown> =>
    rejectNotImplemented("LLMClient.embed");
  embedMany = (..._args: unknown[]): Promise<unknown> =>
    rejectNotImplemented("LLMClient.embedMany");
  transcribe = (..._args: unknown[]): Promise<unknown> =>
    rejectNotImplemented("LLMClient.transcribe");
  generateSpeech = (..._args: unknown[]): Promise<unknown> =>
    rejectNotImplemented("LLMClient.generateSpeech");
}

export class AISdkClient extends LLMClient {
  constructor({ model }: { model: unknown }) {
    super(String((model as { name?: string })?.name ?? "unknown"));
  }

  createChatCompletion<T = LLMResponse>(
    options: CreateChatCompletionOptions,
  ): Promise<T> {
    void options;
    return rejectNotImplemented("AISdkClient.createChatCompletion");
  }
}

export class AgentProvider {
  constructor(private readonly logger?: Logger) {}

  getClient(
    _modelName: string,
    _clientOptions?: Record<string, unknown>,
    _userProvidedInstructions?: string,
    _tools?: Record<string, unknown>,
  ): AgentClient {
    return notImplemented("AgentProvider.getClient");
  }
}

export class V3Evaluator {
  constructor(private readonly v3: V3) {
    void this.v3;
  }

  getClient(): unknown {
    return notImplemented("V3Evaluator.getClient");
  }

  ask(
    _instruction: string,
    _options?: Record<string, unknown>,
  ): Promise<unknown> {
    return rejectNotImplemented("V3Evaluator.ask");
  }

  batchAsk(
    _instructions: Array<{ instruction: string; options?: Record<string, unknown> }>,
  ): Promise<unknown> {
    return rejectNotImplemented("V3Evaluator.batchAsk");
  }

  protected _evaluateWithMultipleScreenshots(): Promise<unknown> {
    return rejectNotImplemented("V3Evaluator._evaluateWithMultipleScreenshots");
  }
}

export async function connectToMCPServer(
  _serverConfig:
    | string
    | URL
    | StdioServerConfig
    | ConnectToMCPServerOptions,
): Promise<MCPClient> {
  return rejectNotImplemented<MCPClient>("connectToMCPServer");
}

export class V3 {
  public llmClient!: LLMClient;
  public readonly experimental = false;
  public readonly logInferenceToFile = false;
  public readonly disableAPI = true;
  public verbose: 0 | 1 | 2 = 1;
  public browserbaseSessionId?: string;
  public stagehandMetrics: StagehandMetrics = {};
  protected historyEntries: HistoryEntry[] = [];
  protected currentMetrics: StagehandMetrics = {};

  constructor(public readonly opts: V3Options = {}) {}

  get browserbaseSessionID(): string | undefined {
    return undefined;
  }

  get browserbaseSessionURL(): string | undefined {
    return undefined;
  }

  get browserbaseDebugURL(): string | undefined {
    return undefined;
  }

  get metrics(): Promise<StagehandMetrics> {
    return rejectNotImplemented("V3.metrics");
  }

  async init(): Promise<void> {
    return notImplemented("V3.init");
  }

  async close(_opts?: { force?: boolean }): Promise<void> {
    return notImplemented("V3.close");
  }

  async act(
    _input: string | Action,
    _options?: ActOptions,
  ): Promise<ActResult> {
    return notImplemented("V3.act");
  }

  async extract<T = unknown>(
    _instructionOrSchema?: string | JsonSchema,
    _schemaOrOptions?: JsonSchema | ExtractOptions,
    _maybeOptions?: ExtractOptions,
  ): Promise<T> {
    return notImplemented("V3.extract");
  }

  async observe(
    _instructionOrOptions?: string | ObserveOptions,
    _maybeOptions?: ObserveOptions,
  ): Promise<Action[]> {
    return notImplemented("V3.observe");
  }

  agent(_options?: AgentConfig) {
    return {
      execute: (
        instructionOrOptions: string | AgentExecuteOptions,
        _page?: AnyPage,
      ): Promise<AgentResult> => {
        void instructionOrOptions;
        return rejectNotImplemented("V3.agent.execute");
      },
    };
  }

  isAgentReplayActive(): boolean {
    return false;
  }

  isAgentReplayRecording(): boolean {
    return false;
  }

  beginAgentReplayRecording(): void {}

  endAgentReplayRecording(): AgentReplayStep[] {
    return notImplemented("V3.endAgentReplayRecording");
  }

  discardAgentReplayRecording(): void {}

  recordAgentReplayStep(_step: AgentReplayStep): void {}

  get history(): Promise<ReadonlyArray<HistoryEntry>> {
    return Promise.resolve(this.historyEntries);
  }

  addToHistory(
    functionName: V3Fn | string,
    parameters: Record<string, unknown>,
  ): void {
    this.historyEntries.push({
      functionName,
      parameters,
      timestamp: new Date().toISOString(),
    });
  }

  updateMetrics(partial: Partial<StagehandMetrics>): void {
    this.currentMetrics = { ...this.currentMetrics, ...partial };
    this.stagehandMetrics = { ...this.stagehandMetrics, ...partial };
  }

  updateTotalMetrics(partial: Partial<StagehandMetrics>): void {
    this.updateMetrics(partial);
  }

  connectURL(): string {
    return notImplemented("V3.connectURL");
  }

  get context(): unknown {
    return notImplemented("V3.context");
  }

  get logger(): Logger {
    return (_log) => {
      throw new StagehandSDKNotImplementedError("V3.logger");
    };
  }
}

export class Stagehand extends V3 {}

export default Stagehand;
