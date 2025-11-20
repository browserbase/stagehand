import { describe, expectTypeOf, it } from "vitest";
import * as Stagehand from "../../dist/index.js";

// Type-level manifest of all expected exported types
// Since these types don't exist at runtime, we currently need to manually add new publicly exported types
// to this list ourselves - it's not automatically going to catch changes like our export-surface.test.ts does.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type ExpectedExportedTypes = {
  // Types from model.ts
  AvailableModel: Stagehand.AvailableModel;
  AvailableCuaModel: Stagehand.AvailableCuaModel;
  ModelProvider: Stagehand.ModelProvider;
  ClientOptions: Stagehand.ClientOptions;
  ModelConfiguration: Stagehand.ModelConfiguration;
  AnthropicJsonSchemaObject: Stagehand.AnthropicJsonSchemaObject;
  AISDKProvider: Stagehand.AISDKProvider;
  AISDKCustomProvider: Stagehand.AISDKCustomProvider;
  LLMTool: Stagehand.LLMTool;
  // Types from methods.ts
  ActOptions: Stagehand.ActOptions;
  ActResult: Stagehand.ActResult;
  ExtractResult: Stagehand.ExtractResult<Stagehand.StagehandZodSchema>;
  Action: Stagehand.Action;
  HistoryEntry: Stagehand.HistoryEntry;
  ExtractOptions: Stagehand.ExtractOptions;
  ObserveOptions: Stagehand.ObserveOptions;
  V3FunctionName: Stagehand.V3FunctionName;
  // Types from agent.ts
  AgentAction: Stagehand.AgentAction;
  AgentResult: Stagehand.AgentResult;
  AgentExecuteOptions: Stagehand.AgentExecuteOptions;
  AgentType: Stagehand.AgentType;
  AgentExecutionOptions: Stagehand.AgentExecutionOptions<Stagehand.AgentExecuteOptions>;
  AgentHandlerOptions: Stagehand.AgentHandlerOptions;
  ActionExecutionResult: Stagehand.ActionExecutionResult;
  ToolUseItem: Stagehand.ToolUseItem;
  AnthropicMessage: Stagehand.AnthropicMessage;
  AnthropicContentBlock: Stagehand.AnthropicContentBlock;
  AnthropicTextBlock: Stagehand.AnthropicTextBlock;
  AnthropicToolResult: Stagehand.AnthropicToolResult;
  ResponseItem: Stagehand.ResponseItem;
  ComputerCallItem: Stagehand.ComputerCallItem;
  FunctionCallItem: Stagehand.FunctionCallItem;
  ResponseInputItem: Stagehand.ResponseInputItem;
  AgentInstance: Stagehand.AgentInstance;
  AgentProviderType: Stagehand.AgentProviderType;
  AgentModelConfig: Stagehand.AgentModelConfig;
  AgentConfig: Stagehand.AgentConfig;
  // Types from logs.ts
  LogLevel: Stagehand.LogLevel;
  LogLine: Stagehand.LogLine;
  Logger: Stagehand.Logger;
  // Types from metrics.ts
  StagehandMetrics: Stagehand.StagehandMetrics;
  // Types from options.ts
  V3Env: Stagehand.V3Env;
  LocalBrowserLaunchOptions: Stagehand.LocalBrowserLaunchOptions;
  V3Options: Stagehand.V3Options;
  // Types from page.ts
  AnyPage: Stagehand.AnyPage;
  Page: Stagehand.Page;
  PlaywrightPage: Stagehand.PlaywrightPage;
  PatchrightPage: Stagehand.PatchrightPage;
  PuppeteerPage: Stagehand.PuppeteerPage;
  ConsoleListener: Stagehand.ConsoleListener;
  LoadState: Stagehand.LoadState;
  // Types from LLMClient.ts
  ChatMessage: Stagehand.ChatMessage;
  ChatMessageContent: Stagehand.ChatMessageContent;
  ChatMessageImageContent: Stagehand.ChatMessageImageContent;
  ChatMessageTextContent: Stagehand.ChatMessageTextContent;
  ChatCompletionOptions: Stagehand.ChatCompletionOptions;
  LLMResponse: Stagehand.LLMResponse;
  CreateChatCompletionOptions: Stagehand.CreateChatCompletionOptions;
  LLMUsage: Stagehand.LLMUsage;
  LLMParsedResponse: Stagehand.LLMParsedResponse<Record<string, unknown>>;
  // Types from zodCompat.ts
  StagehandZodSchema: Stagehand.StagehandZodSchema;
  StagehandZodObject: Stagehand.StagehandZodObject;
  InferStagehandSchema: Stagehand.InferStagehandSchema<Stagehand.StagehandZodSchema>;
  JsonSchemaDocument: Stagehand.JsonSchemaDocument;
  // Types from utils.ts
  JsonSchema: Stagehand.JsonSchema;
  JsonSchemaProperty: Stagehand.JsonSchemaProperty;
};

describe("Stagehand public API types", () => {
  describe("AnyPage", () => {
    type ExpectedAnyPage =
      | Stagehand.PlaywrightPage
      | Stagehand.PuppeteerPage
      | Stagehand.PatchrightPage
      | Stagehand.Page
      | Stagehand.PageHandle;

    it("matches expected type shape", () => {
      expectTypeOf<Stagehand.AnyPage>().toEqualTypeOf<ExpectedAnyPage>();
    });
  });

  describe("ActOptions", () => {
    type ExpectedActOptions = {
      model?: Stagehand.ModelConfiguration;
      variables?: Record<string, string>;
      timeout?: number;
      page?: Stagehand.AnyPage;
    };

    it("matches expected type shape", () => {
      expectTypeOf<Stagehand.ActOptions>().toEqualTypeOf<ExpectedActOptions>();
    });
  });
});
