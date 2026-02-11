export { V3 } from "./v3.js";
export { V3 as Stagehand } from "./v3.js";

export * from "./types/public/index.js";
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

export type {
  Cookie,
  CookieParam,
  ClearCookieOptions,
  StorageState,
} from "./understudy/cookies";
