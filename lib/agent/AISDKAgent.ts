import { Stagehand } from "../index";
import { Page } from "../../types/page";
import { LLMClient } from "../llm/LLMClient";
import { createAgentTools } from "./tools";
import {
  buildAISDKSystemPrompt,
  buildAISDKMessages,
  createAbortableStream,
  processToolCallStream,
  trackStreamedText,
} from "./utils/aiSDKUtils";
import { streamText, type LanguageModel } from "ai";
import { AISdkClient } from "../llm/aisdk";

import type {
  CoreMessage,
  TextStreamPart,
  ToolSet,
  ToolCall,
  ToolResult,
  FinishReason,
  StepResult,
  LanguageModelUsage,
} from "ai";

type ExtendedStreamResult = {
  textStream: AsyncIterable<string> & ReadableStream<string>;
  fullStream: AsyncIterable<TextStreamPart<ToolSet>> &
    ReadableStream<TextStreamPart<ToolSet>>;
  usage: Promise<LanguageModelUsage>;
  text: Promise<string>;
  toolCalls: Promise<ToolCall<string, unknown>[]>;
  toolResults: Promise<ToolResult<string, unknown, unknown>[]>;
  finishReason: Promise<FinishReason>;
  messages: Promise<CoreMessage[]>;
  streamedText: string;
  stop: () => void;
};

/**
 * Extended AI SDK Agent interface that exposes streaming capabilities by default
 * This provides a higher-level abstraction over the AISDKClient
 */
export class AISDKAgent {
  private llmClient: LLMClient;
  private stagehand: Stagehand;
  private page: Page;
  private userProvidedInstructions?: string;
  private languageModel: LanguageModel;

  constructor(options: {
    stagehand: Stagehand;
    page: Page;
    modelName: string;
    apiKey?: string;
    userProvidedInstructions?: string;
  }) {
    this.stagehand = options.stagehand;
    this.page = options.page;
    this.userProvidedInstructions = options.userProvidedInstructions;

    this.llmClient = this.stagehand.llmProvider.getClient(
      options.modelName as Parameters<
        typeof this.stagehand.llmProvider.getClient
      >[0],
      { apiKey: options.apiKey },
    );

    if ("languageModel" in this.llmClient && this.llmClient.type === "aisdk") {
      this.languageModel = (this.llmClient as AISdkClient).languageModel;
    } else {
      throw new Error(
        `AISDKAgent requires an AI SDK compatible model. Model "${options.modelName}" is not supported by the AI SDK. ` +
          `Use models in "provider/model-id" format (e.g., "openai/gpt-4", "anthropic/claude-3-5-sonnet").`,
      );
    }
  }

  async execute(options: {
    instruction: string;
    maxSteps?: number;
    messages?: CoreMessage[];
    onToolCall?: (toolName: string, args: unknown) => void;
    onTextDelta?: (text: string) => void;
    onStepFinish?: (stepInfo: StepResult<ToolSet>) => void;
    onError?: (event: { error: unknown }) => Promise<void> | void;
    onFinish?: (
      result: Omit<StepResult<ToolSet>, "stepType" | "isContinued"> & {
        steps: StepResult<ToolSet>[];
        messages: CoreMessage[];
      },
    ) => Promise<void> | void;
  }): Promise<ExtendedStreamResult> {
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
    onStepFinish?: (event: StepResult<ToolSet>) => void;
    onChunk?: (event: { chunk: TextStreamPart<ToolSet> }) => void;
  }) {
    const tools = options.tools || createAgentTools(this.page, this.stagehand);

    return streamText({
      model: this.languageModel,
      messages: options.messages,
      system: options.system,
      temperature: options.temperature,
      maxSteps: options.maxSteps || 10,
      maxTokens: options.maxTokens,
      tools,
      toolCallStreaming: false,
      onStepFinish: options.onStepFinish,
      onChunk: options.onChunk,
    });
  }

  /**
   * Internal: Stream execution with custom handlers
   */
  private async streamExecution(options: {
    instruction: string;
    maxSteps?: number;
    temperature?: number;
    maxTokens?: number;
    messages?: CoreMessage[];
    onToolCall?: (toolName: string, args: unknown) => void;
    onTextDelta?: (text: string) => void;
    onStepFinish?: (stepInfo: StepResult<ToolSet>) => void;
    onError?: (event: { error: unknown }) => Promise<void> | void;
    onFinish?: (
      result: Omit<StepResult<ToolSet>, "stepType" | "isContinued"> & {
        steps: StepResult<ToolSet>[];
        messages: CoreMessage[];
      },
    ) => Promise<void> | void;
  }): Promise<ExtendedStreamResult> {
    const system = buildAISDKSystemPrompt(options.instruction);
    const aiMessages = buildAISDKMessages(
      options.instruction,
      options.messages,
    );

    const abortController = new AbortController();
    let streamedText = "";
    let messagesPromiseResolve: (messages: CoreMessage[]) => void;
    const messagesPromise = new Promise<CoreMessage[]>((resolve) => {
      messagesPromiseResolve = resolve;
    });

    const tools = createAgentTools(this.page, this.stagehand);

    const result = streamText({
      model: this.languageModel,
      messages: aiMessages,
      system,
      maxSteps: options.maxSteps || 10,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      tools,
      toolCallStreaming: false,
      onStepFinish: options.onStepFinish,
      onChunk: options.onTextDelta
        ? (event) => {
            if (event.chunk.type === "text-delta") {
              options.onTextDelta(event.chunk.textDelta);
            }
          }
        : undefined,
      onError: options.onError,
      onFinish: (event) => {
        const maxStepsLimit = options.maxSteps || 10;
        if (event.steps && event.steps.length >= maxStepsLimit) {
          this.stagehand.log({
            category: "agent",
            message: `Maximum steps limit reached (${maxStepsLimit} steps). The task may require more iterations. Consider increasing maxSteps if needed.`,
            level: 1,
          });
        }

        const messages = event.response?.messages || [];
        messagesPromiseResolve(messages);

        if (options.onFinish) {
          options.onFinish({
            ...event,
            messages,
          });
        }
      },
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
      messages: messagesPromise,
      streamedText,
      stop: () => abortController.abort(),
    };
  }
}
