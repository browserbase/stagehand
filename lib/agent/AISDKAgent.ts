import { AISDKClient } from "./AISDKClient";
import { Stagehand } from "../index";
import { Page } from "../../types/page";
import {
  buildAISDKSystemPrompt,
  buildAISDKMessages,
  createAbortableStream,
  processToolCallStream,
  trackStreamedText,
} from "./utils/aiSDKUtils";

import type {
  CoreMessage,
  TextStreamPart,
  ToolSet,
  ToolCall,
  ToolResult,
  FinishReason,
  StepResult,
} from "ai";

type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/**
 * Extended AI SDK Agent interface that exposes streaming capabilities by default
 * This provides a higher-level abstraction over the AISDKClient
 */
export class AISDKAgent {
  private client: AISDKClient;
  private stagehand: Stagehand;
  private page: Page;

  constructor(options: {
    stagehand: Stagehand;
    page: Page;
    modelName: string;
    apiKey?: string;
    userProvidedInstructions?: string;
  }) {
    this.stagehand = options.stagehand;
    this.page = options.page;

    this.client = new AISDKClient(
      "aisdk",
      options.modelName,
      options.userProvidedInstructions,
      {
        apiKey: options.apiKey,
        stagehand: options.stagehand,
        page: options.page,
      },
    );
  }

  async execute(options: {
    instruction: string;
    maxSteps?: number;
    messages?: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }>;
    onToolCall?: (toolName: string, args: unknown) => void;
    onTextDelta?: (text: string) => void;
    onStepFinish?: (stepInfo: {
      stepType: "initial" | "continue" | "tool-result";
      finishReason: FinishReason;
      usage: TokenUsage;
      text: string;
      reasoning?: string;
      toolCalls?: ToolCall<string, unknown>[];
      toolResults?: ToolResult<string, unknown, unknown>[];
    }) => void;
    onError?: (event: { error: unknown }) => Promise<void> | void;
    onFinish?: (
      result: Omit<StepResult<ToolSet>, "stepType" | "isContinued"> & {
        steps: StepResult<ToolSet>[];
        messages: CoreMessage[];
      },
    ) => Promise<void> | void;
  }): Promise<{
    textStream: AsyncIterable<string> & ReadableStream<string>;
    fullStream: AsyncIterable<TextStreamPart<ToolSet>> &
      ReadableStream<TextStreamPart<ToolSet>>;
    usage: Promise<TokenUsage>;
    text: Promise<string>;
    toolCalls: Promise<ToolCall<string, unknown>[]>;
    toolResults: Promise<ToolResult<string, unknown, unknown>[]>;
    finishReason: Promise<FinishReason>;
    streamedText: string;
    stop: () => void;
  }> {
    return this.streamExecution({
      instruction: options.instruction,
      maxSteps: options.maxSteps,
      messages: options.messages,
      onToolCall: options.onToolCall,
      onTextDelta: options.onTextDelta,
      onStepFinish: options.onStepFinish,
      onError: options.onError,
      onFinish: options.onFinish,
    });
  }

  /**
   * Stream text generation with custom messages
   * Allows for multi-turn conversations and custom tool sets
   */
  async streamText(options: {
    messages: CoreMessage[];
    system?: string;
    temperature?: number;
    maxSteps?: number;
    maxTokens?: number;
    tools?: ToolSet;
    onStepFinish?: (event: {
      stepType: "initial" | "continue" | "tool-result";
      finishReason: FinishReason;
      usage: TokenUsage;
      text: string;
      reasoning?: string;
      toolCalls?: ToolCall<string, unknown>[];
      toolResults?: ToolResult<string, unknown, unknown>[];
    }) => void;
    onChunk?: (event: { chunk: TextStreamPart<ToolSet> }) => void;
  }) {
    return this.client.streamText(options);
  }

  /**
   * Internal: Stream execution with custom handlers
   */
  private async streamExecution(options: {
    instruction: string;
    maxSteps?: number;
    temperature?: number;
    maxTokens?: number;
    messages?: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }>;
    onToolCall?: (toolName: string, args: unknown) => void;
    onTextDelta?: (text: string) => void;
    onStepFinish?: (stepInfo: unknown) => void;
    onError?: (event: { error: unknown }) => Promise<void> | void;
    onFinish?: (
      result: Omit<StepResult<ToolSet>, "stepType" | "isContinued"> & {
        steps: StepResult<ToolSet>[];
        messages: CoreMessage[];
      },
    ) => Promise<void> | void;
  }): Promise<{
    textStream: AsyncIterable<string> & ReadableStream<string>;
    fullStream: AsyncIterable<TextStreamPart<ToolSet>> &
      ReadableStream<TextStreamPart<ToolSet>>;
    usage: Promise<TokenUsage>;
    text: Promise<string>;
    toolCalls: Promise<ToolCall<string, unknown>[]>;
    toolResults: Promise<ToolResult<string, unknown, unknown>[]>;
    finishReason: Promise<FinishReason>;
    streamedText: string;
    stop: () => void;
  }> {
    const system = buildAISDKSystemPrompt(options.instruction);
    const messages = buildAISDKMessages(options.instruction, options.messages);

    const abortController = new AbortController();
    let streamedText = "";

    const result = await this.client.streamText({
      messages,
      system,
      maxSteps: options.maxSteps,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      onStepFinish: options.onStepFinish,
      onChunk: options.onTextDelta
        ? (event) => {
            if (event.chunk.type === "text-delta") {
              options.onTextDelta(event.chunk.textDelta);
            }
          }
        : undefined,
      onError: options.onError,
      onFinish: options.onFinish
        ? (event) =>
            options.onFinish!({
              ...event,
              messages: event.response?.messages || [],
            })
        : undefined,
    });

    if (options.onToolCall) {
      processToolCallStream(
        result.fullStream,
        options.onToolCall,
        abortController.signal,
      );
    }

    trackStreamedText(result.textStream, abortController.signal).then(
      (text) => {
        streamedText = text;
      },
    );

    return {
      textStream: createAbortableStream(result.textStream, abortController),
      fullStream: createAbortableStream(result.fullStream, abortController),
      usage: result.usage,
      text: result.text,
      toolCalls: result.toolCalls,
      toolResults: result.toolResults,
      finishReason: result.finishReason,
      streamedText,
      stop: () => abortController.abort(),
    };
  }
}
