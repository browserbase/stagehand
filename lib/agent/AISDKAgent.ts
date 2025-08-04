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
import {
  streamText,
  type LanguageModel,
  wrapLanguageModel,
  type LanguageModelV1Middleware,
  type LanguageModelV1CallOptions,
} from "ai";
import { AISdkClient } from "../llm/aisdk";
import { LLMProvider } from "../llm/LLMProvider";
import { AvailableModel } from "../../types/model";
import { StagehandError } from "../../types/stagehandErrors";

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

    // Transform model name to provider/model format if needed
    let modelName = options.modelName;
    if (!modelName.includes("/")) {
      try {
        const provider = LLMProvider.getModelProvider(
          modelName as AvailableModel,
        );
        if (provider && provider !== "aisdk") {
          modelName = `${provider}/${modelName}`;
        }
      } catch {
        throw new StagehandError(
          `Model "${modelName}" not recognized. Please use the "provider/model-id" format (e.g., "openai/gpt-4o", "anthropic/claude-3-5-sonnet").`,
        );
      }
    }

    this.llmClient = this.stagehand.llmProvider.getClient(
      modelName as Parameters<typeof this.stagehand.llmProvider.getClient>[0],
      { apiKey: options.apiKey },
    );

    if ("languageModel" in this.llmClient && this.llmClient.type === "aisdk") {
      const baseModel = (this.llmClient as AISdkClient).languageModel;

      //  middleware for custom message processing
      const messageProcessingMiddleware: LanguageModelV1Middleware = {
        transformParams: async ({
          params,
        }: {
          params: LanguageModelV1CallOptions;
        }) => {
          const processedPrompt = params.prompt.map((message) => {
            // custom message processing logic will go here
            return {
              ...message,
            };
          });

          return {
            ...params,
            prompt: processedPrompt,
          };
        },
      };

      this.languageModel = wrapLanguageModel({
        model: baseModel,
        middleware: messageProcessingMiddleware,
      });
    } else {
      throw new StagehandError(
        `AISDKAgent requires an AI SDK compatible model. Model "${options.modelName}" is not supported by the AI SDK. ` +
          `Use either a simple model name (e.g., "gpt-4o", "claude-3-5-sonnet-latest") or ` +
          `the "provider/model-id" format (e.g., "openai/gpt-4o", "anthropic/claude-3-5-sonnet").`,
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
