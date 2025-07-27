import { AISDKClient } from "./AISDKClient";
import { Stagehand } from "../index";
import { Page } from "../../types/page";
import { LogLine } from "../../types/log";
import type { CoreMessage, TextStreamPart, ToolSet } from "ai";

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

  /**
   * Execute a task with streaming by default
   * Since we use streamText internally, streaming is the natural behavior
   */
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
      finishReason:
        | "stop"
        | "length"
        | "content-filter"
        | "tool-calls"
        | "error"
        | "other"
        | "unknown";
      usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      };
      text: string;
      reasoning?: string;
      toolCalls?: unknown[];
      toolResults?: unknown[];
    }) => void;
  }): Promise<{
    textStream: AsyncIterable<string> & ReadableStream<string>;
    fullStream: AsyncIterable<TextStreamPart<ToolSet>> &
      ReadableStream<TextStreamPart<ToolSet>>;
    usage: Promise<unknown>;
    text: Promise<string>;
    toolCalls: Promise<unknown>;
    toolResults: Promise<unknown>;
    finishReason: Promise<unknown>;
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
      finishReason:
        | "stop"
        | "length"
        | "content-filter"
        | "tool-calls"
        | "error"
        | "other"
        | "unknown";
      usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      };
      text: string;
      reasoning?: string;
      toolCalls?: unknown[];
      toolResults?: unknown[];
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
  }): Promise<{
    textStream: AsyncIterable<string> & ReadableStream<string>;
    fullStream: AsyncIterable<TextStreamPart<ToolSet>> &
      ReadableStream<TextStreamPart<ToolSet>>;
    usage: Promise<unknown>;
    text: Promise<string>;
    toolCalls: Promise<unknown>;
    toolResults: Promise<unknown>;
    finishReason: Promise<unknown>;
    streamedText: string;
    stop: () => void;
  }> {
    const system = this.buildSystemPrompt(options.instruction);

    // Build messages array - include history if provided
    const messages: CoreMessage[] = options.messages
      ? [
          ...(options.messages as CoreMessage[]),
          { role: "user", content: options.instruction },
        ]
      : [{ role: "user", content: options.instruction }];

    // Create abort controller for stopping the stream
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
    });

    // Process stream for tool call callbacks if provided
    if (options.onToolCall) {
      (async () => {
        try {
          for await (const part of result.fullStream) {
            if (abortController.signal.aborted) break;
            if (part.type === "tool-call") {
              options.onToolCall(part.toolName, part.args);
            }
          }
        } catch {
          // Stream was aborted or errored
        }
      })();
    }

    // Track streamed text
    (async () => {
      try {
        for await (const textPart of result.textStream) {
          if (abortController.signal.aborted) break;
          streamedText += textPart;
        }
      } catch {
        // Stream was aborted or errored
      }
    })();

    // Create wrapped streams that respect abort signal
    const createAbortableStream = <T>(
      originalStream: AsyncIterable<T> & ReadableStream<T>,
    ) => {
      const reader = originalStream[Symbol.asyncIterator]();

      return new ReadableStream<T>({
        async pull(controller) {
          if (abortController.signal.aborted) {
            controller.close();
            return;
          }

          const { done, value } = await reader.next();
          if (done || abortController.signal.aborted) {
            controller.close();
          } else {
            controller.enqueue(value);
          }
        },
        cancel() {
          abortController.abort();
        },
      }) as AsyncIterable<T> & ReadableStream<T>;
    };

    return {
      textStream: createAbortableStream(result.textStream),
      fullStream: createAbortableStream(result.fullStream),
      usage: result.usage,
      text: result.text,
      toolCalls: result.toolCalls,
      toolResults: result.toolResults,
      finishReason: result.finishReason,
      streamedText,
      stop: () => {
        abortController.abort();
      },
    };
  }

  private buildSystemPrompt(userGoal: string): string {
    const currentDateTime = new Date().toLocaleString();

    return `You are a helpful web automation assistant using Stagehand tools to accomplish the user's goal: ${userGoal}

PRIMARY APPROACH:
1. THINK first - Use the think tool to analyze the goal and plan
2. Take ONE atomic step at a time toward completion

ACTION EXECUTION:
- Use getText to understand the page
- Use navigate to go to URLs
- Use actClick to click elements
- Use actType to type text
- Use wait after actions that may cause navigation
- Use screenshot to verify results

Current date and time: ${currentDateTime}`;
  }

  private createLogger() {
    return (log: LogLine) => {
      // Simple console logger - can be customized
      if (log.level === 0) {
        console.error(`[${log.category}] ${log.message}`);
      } else if (log.level === 1) {
        console.log(`[${log.category}] ${log.message}`);
      } else {
        console.debug(`[${log.category}] ${log.message}`);
      }
    };
  }
}
