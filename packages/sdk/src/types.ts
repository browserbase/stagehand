export type AvailableModel = string;
export type AvailableCuaModel = string;
export type ModelProvider = string;

export interface ClientOptions {
  [key: string]: unknown;
}

export interface ModelConfiguration {
  modelName?: AvailableModel;
  clientOptions?: ClientOptions;
}

export interface AISDKProvider {
  name: string;
  description?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
}

export interface AISDKCustomProvider extends AISDKProvider {
  headers?: Record<string, string>;
}

export type LLMTool = {
  type: string;
  name: string;
  description?: string;
  parameters?: unknown;
};

export interface Action {
  selector?: string;
  method?: string;
  arguments?: string[];
  description?: string;
}

export interface ActResult {
  success: boolean;
  message: string;
  actionDescription?: string;
  actions?: Action[];
}

export interface HistoryEntry {
  functionName: string;
  parameters: Record<string, unknown>;
  timestamp: string;
}

export interface ActOptions {
  model?: ModelConfiguration | string;
  variables?: Record<string, string>;
  timeout?: number;
  page?: AnyPage;
}

export interface ExtractOptions {
  model?: ModelConfiguration | string;
  timeout?: number;
  selector?: string;
  page?: AnyPage;
}

export interface ObserveOptions {
  model?: ModelConfiguration | string;
  timeout?: number;
  selector?: string;
  page?: AnyPage;
}

export enum V3FunctionName {
  ACT = "ACT",
  EXTRACT = "EXTRACT",
  OBSERVE = "OBSERVE",
  AGENT = "AGENT",
}

export interface AgentAction extends Action {}

export interface AgentResult {
  success: boolean;
  steps?: AgentAction[];
  output?: string;
}

export interface AgentExecuteOptions {
  instruction: string;
  page?: AnyPage;
  maxSteps?: number;
  tools?: Record<string, unknown>;
}

export type AgentType = string;

export interface AgentExecutionOptions<T = AgentExecuteOptions> {
  instruction: string;
  options?: T;
}

export interface AgentHandlerOptions {
  type?: AgentType;
  model?: ModelConfiguration | string;
  systemPrompt?: string;
}

export interface ActionExecutionResult {
  action: AgentAction;
  success: boolean;
  error?: string;
}

export interface ToolUseItem {
  [key: string]: unknown;
}

export interface ZodPathSegments {
  segments: Array<string | number>;
}

export interface AnthropicMessage {
  id?: string;
  role?: string;
  content?: Array<AnthropicContentBlock>;
}

export interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
}

export interface AnthropicTextBlock {
  type: "text";
  text: string;
}

export interface AnthropicToolResult {
  type: "tool_result";
  result?: unknown;
}

export type ResponseItem = Record<string, unknown>;
export type ComputerCallItem = Record<string, unknown>;
export type FunctionCallItem = Record<string, unknown>;
export type ResponseInputItem = Record<string, unknown>;

export interface AgentInstance {
  execute(options: AgentExecutionOptions): Promise<AgentResult>;
}

export type AgentProviderType = string;

export interface AgentModelConfig {
  modelName: AvailableModel;
  provider?: AgentProviderType;
}

export interface AgentConfig extends AgentHandlerOptions {
  model?: ModelConfiguration | string;
  executionModel?: ModelConfiguration | string;
  cua?: boolean;
  tools?: Record<string, unknown>;
  integrations?: unknown[];
}

export interface AgentClient {
  execute(options: AgentExecutionOptions): Promise<AgentResult>;
  captureScreenshot?(options?: Record<string, unknown>): Promise<unknown>;
  setViewport?(width: number, height: number): void;
  setCurrentUrl?(url: string): void;
  setScreenshotProvider?(provider: () => Promise<string>): void;
  setActionHandler?(handler: (action: AgentAction) => Promise<void>): void;
}

export type LogLevel = 0 | 1 | 2;

export interface LogLine {
  id?: string;
  category?: string;
  message: string;
  level?: LogLevel;
  timestamp?: string;
  auxiliary?: Record<
    string,
    {
      value: string;
      type: "object" | "string" | "html" | "integer" | "float" | "boolean";
    }
  >;
}

export type Logger = (logLine: LogLine) => void;

export interface StagehandMetrics {
  totalPromptTokens?: number;
  totalCompletionTokens?: number;
  totalReasoningTokens?: number;
  totalCachedInputTokens?: number;
  totalInferenceTimeMs?: number;
}

export type V3Env = "LOCAL" | "BROWSERBASE";

export interface LocalBrowserLaunchOptions {
  args?: string[];
  executablePath?: string;
  userDataDir?: string;
  headless?: boolean;
  devtools?: boolean;
  locale?: string;
  viewport?: {
    width: number;
    height: number;
  };
  deviceScaleFactor?: number;
  hasTouch?: boolean;
  ignoreHTTPSErrors?: boolean;
  proxy?: {
    server?: string;
    bypass?: string;
  };
  preserveUserDataDir?: boolean;
  connectTimeoutMs?: number;
  downloadsPath?: string;
  acceptDownloads?: boolean;
}

export interface V3Options {
  env?: V3Env;
  apiKey?: string;
  projectId?: string;
  cacheDir?: string;
  logger?: Logger;
  systemPrompt?: string;
  verbose?: 0 | 1 | 2;
  model?: ModelConfiguration | string;
  llmClient?: unknown;
  selfHeal?: boolean;
  disableAPI?: boolean;
  browserbaseSessionID?: string;
  browserbaseSessionCreateParams?: Record<string, unknown>;
}

export interface PageHandle {
  targetId?: string;
  sessionId?: string;
}

export type AnyPage =
  | PageHandle
  | {
      kind?: string;
      reference?: unknown;
    }
  | unknown;

// Core only exposes these as TypeScript aliases (no runtime objects), so the SDK
// mirrors that shape and relies on AnyPage underneath.
export type Page = AnyPage;
export type PlaywrightPage = AnyPage;
export type PatchrightPage = AnyPage;
export type PuppeteerPage = AnyPage;

export type ConsoleListener = (message: unknown) => void;

export type LoadState = "load" | "domcontentloaded" | "networkidle";

export interface ChatMessageImageContent {
  type: string;
  image_url?: { url: string };
  text?: string;
  source?: {
    type: string;
    media_type: string;
    data: string;
  };
}

export interface ChatMessageTextContent {
  type: string;
  text: string;
}

export type ChatMessageContent =
  | string
  | Array<ChatMessageImageContent | ChatMessageTextContent>;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: ChatMessageContent;
}

export interface ChatCompletionOptions {
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  image?: {
    buffer: Buffer;
    description?: string;
  };
  response_model?: {
    name: string;
    schema: StagehandZodSchema;
  };
  tools?: LLMTool[];
  tool_choice?: "auto" | "none" | "required";
  maxOutputTokens?: number;
  requestId?: string;
}

export type LLMResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls: {
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }[];
    };
    finish_reason: string;
  }[];
  usage: LLMUsage;
};

export interface CreateChatCompletionOptions {
  options: ChatCompletionOptions;
  logger: Logger;
  retries?: number;
}

export interface LLMUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  reasoning_tokens?: number;
  cached_input_tokens?: number;
}

export interface LLMParsedResponse<T> {
  data: T;
  usage?: LLMUsage;
}

export interface StagehandZodSchema {
  kind?: string;
  shape?: Record<string, unknown>;
}

export interface StagehandZodObject extends StagehandZodSchema {}

export type InferStagehandSchema<T extends StagehandZodSchema> = unknown;

export type JsonSchemaDocument = Record<string, unknown>;
export type JsonSchema = Record<string, unknown>;
export type JsonSchemaProperty = Record<string, unknown>;

export type ExtractResult<T extends StagehandZodSchema> = unknown;

export interface ObserveResult {
  actions: Action[];
}

export interface AgentReplayStep {
  type: string;
  payload?: unknown;
}

export interface MCPClient {
  [key: string]: unknown;
}

export interface ConnectToMCPServerOptions {
  serverUrl: string | URL;
  clientOptions?: ClientOptions;
}

export interface StdioServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}
