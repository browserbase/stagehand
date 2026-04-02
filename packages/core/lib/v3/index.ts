import * as PublicApi from "./types/public/index.js";
import { V3 } from "./v3.js";
import { AnnotatedScreenshotText, LLMClient } from "./llm/LLMClient.js";
import {
  AgentProvider,
  modelToAgentProviderMap,
} from "./agent/AgentProvider.js";
import {
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
} from "../utils.js";
import { isZod4Schema, isZod3Schema, toJsonSchema } from "./zodCompat.js";
import { connectToMCPServer } from "./mcp/connection.js";
import { V3Evaluator } from "../v3Evaluator.js";
import { tool } from "ai";
import { getAISDKLanguageModel } from "./llm/LLMProvider.js";
import { __internalCreateInMemoryAgentCacheHandle } from "./cache/serverAgentCache.js";
import { maybeRunShutdownSupervisorFromArgv } from "./shutdown/supervisor.js";

export { V3 } from "./v3.js";
export { V3 as Stagehand } from "./v3.js";

export * from "./types/public/index.js";
export type {
  LogLine,
  Logger,
} from "./types/public/logs.js";
export type {
  Action,
  ActOptions,
  ActResult,
  ExtractOptions,
  ExtractResult,
  HistoryEntry,
  ObserveOptions,
  ObserveResult,
} from "./types/public/methods.js";
export type {
  AvailableModel,
  ClientOptions,
  ModelConfiguration,
} from "./types/public/model.js";
export type {
  LocalBrowserLaunchOptions,
  V3Env,
  V3Options,
} from "./types/public/options.js";
export { AnnotatedScreenshotText, LLMClient } from "./llm/LLMClient.js";

export {
  AgentProvider,
  modelToAgentProviderMap,
} from "./agent/AgentProvider.js";
export type {
  AgentTools,
  AgentToolTypesMap,
  AgentUITools,
  AgentToolCall,
  AgentToolResult,
} from "./agent/tools/index.js";

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
} from "../utils.js";
export { isZod4Schema, isZod3Schema, toJsonSchema } from "./zodCompat.js";

export { connectToMCPServer } from "./mcp/connection.js";
export { V3Evaluator } from "../v3Evaluator.js";
export { tool } from "ai";
export { getAISDKLanguageModel } from "./llm/LLMProvider.js";
export { __internalCreateInMemoryAgentCacheHandle } from "./cache/serverAgentCache.js";
export { maybeRunShutdownSupervisorFromArgv as __internalMaybeRunShutdownSupervisorFromArgv } from "./shutdown/supervisor.js";
export type { ServerAgentCacheHandle } from "./cache/serverAgentCache.js";

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
} from "./llm/LLMClient.js";

export type {
  StagehandZodSchema,
  StagehandZodObject,
  InferStagehandSchema,
  JsonSchemaDocument,
} from "./zodCompat.js";

export type { JsonSchema, JsonSchemaProperty } from "../utils.js";

const StagehandDefault = {
  ...PublicApi,
  V3,
  Stagehand: V3,
  AnnotatedScreenshotText,
  LLMClient,
  AgentProvider,
  modelToAgentProviderMap,
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
  isZod4Schema,
  isZod3Schema,
  toJsonSchema,
  connectToMCPServer,
  V3Evaluator,
  tool,
  getAISDKLanguageModel,
  __internalCreateInMemoryAgentCacheHandle,
  __internalMaybeRunShutdownSupervisorFromArgv:
    maybeRunShutdownSupervisorFromArgv,
};

export default StagehandDefault;
