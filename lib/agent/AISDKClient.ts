import {
  streamText,
  type CoreMessage,
  type TextStreamPart,
  type ToolSet,
  type StreamTextResult,
  type ToolCall,
  type ToolResult,
  type FinishReason as AIFinishReason,
} from "ai";
import { getAISDKLanguageModel } from "../llm/LLMProvider";

type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

type FinishReason = AIFinishReason;

import {
  AgentAction,
  AgentResult,
  AgentType,
  AgentExecutionOptions,
} from "@/types/agent";
import { AgentClient } from "./AgentClient";
import { createAgentTools } from "./tools";
import { Page } from "../../types/page";
import { Stagehand } from "../index";
import { parseModelName } from "./utils/modelUtils";

/**
 * Client for AI SDK integration with Anthropic
 * This implementation uses the Vercel AI SDK with automatic tool execution
 */
export class AISDKClient extends AgentClient {
  private apiKey: string;
  private provider: string;
  private modelId: string;
  private stagehandInstance: Stagehand;
  private page: Page;

  constructor(
    type: AgentType,
    modelName: string,
    userProvidedInstructions?: string,
    clientOptions?: Record<string, unknown>,
  ) {
    super(type, modelName, userProvidedInstructions);

    const model = parseModelName(modelName);
    if (!model) {
      throw new Error(
        `Invalid model name format: ${modelName}. Expected format: provider/model-id`,
      );
    }
    this.provider = model.provider;
    this.modelId = model.modelId;

    this.apiKey = (clientOptions?.apiKey as string) || "";

    this.clientOptions = {
      apiKey: this.apiKey,
    };

    this.stagehandInstance = clientOptions?.stagehand as Stagehand;
    this.page = clientOptions?.page as Page;
  }

  // These methods are not used by AI SDK but required by base class
  setViewport(): void {}

  setCurrentUrl(): void {}

  setScreenshotProvider(): void {}

  setActionHandler(): void {}

  async captureScreenshot(): Promise<unknown> {
    throw new Error(
      "AISDKClient does not use captureScreenshot. Screenshots are handled through the AI SDK tools.",
    );
  }

  /**
   * Build system prompt for the AI SDK agent
   */
  private buildSystemPrompt(userGoal: string): string {
    const currentDateTime = new Date().toLocaleString();
    const userInstructions = this.userProvidedInstructions
      ? `\n\nAdditional instructions from user: ${this.userProvidedInstructions}`
      : "";

    return `You are a helpful web automation assistant using Stagehand tools to accomplish the user's goal: ${userGoal}${userInstructions}

PRIMARY APPROACH:
1. THINK first - Use the think tool to analyze the goal, break down your approach, and communicate your plan to the user
2. Take ONE atomic step at a time toward completion

ACTION EXECUTION HIERARCHY:

STEP 1: UNDERSTAND THE PAGE
- Use getText to get complete page context before taking actions
- Use screenshot for visual confirmation when needed

STEP 2: TAKE ACTIONS
- Use navigate to go to URLs
- Use actClick to click on buttons, links, or any clickable elements
- Use actType to type text into input fields or text areas
- Use wait after actions that may cause navigation

STEP 3: VERIFY RESULTS
- Take screenshot to verify success when needed
- Use getText to confirm changes


Current date and time: ${currentDateTime}`;
  }

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
    onError?: (event: { error: unknown }) => Promise<void> | void;
    onFinish?: Parameters<typeof streamText>[0]["onFinish"];
  }): Promise<StreamTextResult<ToolSet, never>> {
    const model = getAISDKLanguageModel(
      this.provider,
      this.modelId,
      this.apiKey,
    );
    const tools =
      options.tools || createAgentTools(this.page, this.stagehandInstance);

    const streamOptions = {
      model,
      system: options.system,
      messages: options.messages,
      maxSteps: options.maxSteps || 10,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      tools,
      toolCallStreaming: false,
      onStepFinish: options.onStepFinish,
      onChunk: options.onChunk,
      onError: options.onError,
      onFinish: options.onFinish,
    };

    return streamText<ToolSet>(streamOptions);
  }

  /**
   * Execute a task with the AI SDK
   * @implements AgentClient.execute
   */
  async execute(executionOptions: AgentExecutionOptions): Promise<AgentResult> {
    const { options, logger } = executionOptions;
    const { instruction, onToolCall, onTextDelta, onStepFinish, messages } =
      options;
    const maxSteps = options.maxSteps || 10;

    logger({
      category: "agent",
      message: `AI SDK Client executing with model: ${this.modelName}`,
      level: 1,
    });

    const model = getAISDKLanguageModel(
      this.provider,
      this.modelId,
      this.apiKey,
    );

    const systemPrompt = this.buildSystemPrompt(instruction);
    const actions: AgentAction[] = [];
    let completed = false;
    let finalMessage = "";
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const startTime = Date.now();

    try {
      logger({
        category: "agent",
        message: `Starting AI SDK agent execution with instruction: ${instruction}`,
        level: 2,
      });

      // Create tools with the page and stagehand instances
      const tools = createAgentTools(this.page, this.stagehandInstance);

      // Execute with AI SDK
      const allMessages: CoreMessage[] = messages
        ? [
            ...(messages as CoreMessage[]),
            { role: "user", content: instruction },
          ]
        : [{ role: "user", content: instruction }];

      const result = streamText({
        model,
        system: systemPrompt,
        messages: allMessages,
        maxSteps,
        tools,
        toolCallStreaming: false,
        onStepFinish: (event) => {
          const stepNumber =
            (event as Record<string, unknown>).stepIndex !== undefined
              ? ((event as Record<string, unknown>).stepIndex as number) + 1
              : actions.length + 1;

          logger({
            category: "agent",
            message: `Step ${stepNumber} completed`,
            level: 2,
          });

          // Track tool calls as actions
          if (event.toolCalls && event.toolCalls.length > 0) {
            for (const toolCall of event.toolCalls) {
              const action: AgentAction = {
                type: toolCall.toolName,
                toolCallId: toolCall.toolCallId,
                args: toolCall.args,
              };
              actions.push(action);

              onToolCall?.(toolCall.toolName, toolCall.args);

              logger({
                category: "action",
                message: `Tool called: ${toolCall.toolName}`,
                level: 1,
                auxiliary: {
                  toolName: {
                    value: toolCall.toolName,
                    type: "string" as const,
                  },
                  toolCallId: {
                    value: toolCall.toolCallId,
                    type: "string" as const,
                  },
                },
              });
            }
          }

          // Track usage
          if (event.usage) {
            totalInputTokens += event.usage.promptTokens || 0;
            totalOutputTokens += event.usage.completionTokens || 0;
          }

          onStepFinish?.(event);
        },
      });

      // Wait for the stream to complete and collect the final text
      let fullText = "";
      for await (const textPart of result.textStream) {
        fullText += textPart;
        onTextDelta?.(textPart);
      }

      // Get the final message from the accumulated text
      finalMessage = fullText.trim() || "Task completed";
      completed = true;

      logger({
        category: "agent",
        message: "AI SDK agent execution completed successfully",
        level: 2,
      });

      return {
        success: true,
        message: finalMessage,
        actions,
        completed,
        metadata: {
          totalSteps: actions.length,
          modelUsed: this.modelName,
          provider: this.type,
        },
        usage: {
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
          inference_time_ms: Date.now() - startTime,
        },
      };
    } catch (error) {
      logger({
        category: "agent",
        message: `AI SDK agent execution failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        level: 0,
      });

      return {
        success: false,
        message: `Execution failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        actions,
        completed: false,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}
