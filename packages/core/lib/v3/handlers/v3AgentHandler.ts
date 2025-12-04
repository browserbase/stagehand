import { createAgentTools } from "../agent/tools";
import { LogLine } from "../types/public/logs";
import { V3 } from "../v3";
import {
  ModelMessage,
  ToolSet,
  wrapLanguageModel,
  stepCountIs,
  type LanguageModelUsage,
  type StepResult,
  type GenerateTextOnStepFinishCallback,
  type StreamTextOnStepFinishCallback,
} from "ai";
import { processMessages } from "../agent/utils/messageProcessing";
import { LLMClient } from "../llm/LLMClient";
import {
  AgentExecuteOptions,
  AgentStreamExecuteOptions,
  AgentExecuteOptionsBase,
  AgentResult,
  AgentContext,
  AgentState,
  AgentStreamResult,
  AgentStreamCallbacks,
} from "../types/public/agent";
import { V3FunctionName } from "../types/public/methods";
import { mapToolResultToActions } from "../agent/utils/actionMapping";
import {
  MissingLLMConfigurationError,
  StreamingCallbacksInNonStreamingModeError,
  AgentAbortError,
} from "../types/public/sdkErrors";
import {
  extractAbortSignal,
  getErrorMessage,
  getAbortErrorReason,
} from "../agent/utils/errorHandling";

export class V3AgentHandler {
  private v3: V3;
  private logger: (message: LogLine) => void;
  private llmClient: LLMClient;
  private executionModel?: string;
  private systemInstructions?: string;
  private mcpTools?: ToolSet;

  constructor(
    v3: V3,
    logger: (message: LogLine) => void,
    llmClient: LLMClient,
    executionModel?: string,
    systemInstructions?: string,
    mcpTools?: ToolSet,
  ) {
    this.v3 = v3;
    this.logger = logger;
    this.llmClient = llmClient;
    this.executionModel = executionModel;
    this.systemInstructions = systemInstructions;
    this.mcpTools = mcpTools;
  }

  private async prepareAgent(
    instructionOrOptions: string | AgentExecuteOptionsBase,
  ): Promise<AgentContext> {
    try {
      const options =
        typeof instructionOrOptions === "string"
          ? { instruction: instructionOrOptions }
          : instructionOrOptions;

      const maxSteps = options.maxSteps || 20;

      const systemPrompt = this.buildSystemPrompt(
        options.instruction,
        this.systemInstructions,
      );
      const tools = this.createTools();
      const allTools: ToolSet = { ...tools, ...this.mcpTools };

      // Use provided messages for continuation, or start fresh with the instruction
      const messages: ModelMessage[] = options.messages?.length
        ? [...options.messages, { role: "user", content: options.instruction }]
        : [{ role: "user", content: options.instruction }];

      if (!this.llmClient?.getLanguageModel) {
        throw new MissingLLMConfigurationError();
      }
      const baseModel = this.llmClient.getLanguageModel();
      const wrappedModel = wrapLanguageModel({
        model: baseModel,
        middleware: {
          transformParams: async ({ params }) => {
            const { processedPrompt } = processMessages(params);
            return { ...params, prompt: processedPrompt } as typeof params;
          },
        },
      });

      const initialPageUrl = (await this.v3.context.awaitActivePage()).url();

      return {
        options,
        maxSteps,
        systemPrompt,
        allTools,
        messages,
        wrappedModel,
        initialPageUrl,
      };
    } catch (error) {
      this.logger({
        category: "agent",
        message: `failed to prepare agent: ${error}`,
        level: 0,
      });
      throw error;
    }
  }

  private createStepHandler(
    state: AgentState,
    userCallback?:
      | GenerateTextOnStepFinishCallback<ToolSet>
      | StreamTextOnStepFinishCallback<ToolSet>,
  ) {
    return async (event: StepResult<ToolSet>) => {
      this.logger({
        category: "agent",
        message: `Step finished: ${event.finishReason}`,
        level: 2,
      });

      if (event.toolCalls && event.toolCalls.length > 0) {
        for (let i = 0; i < event.toolCalls.length; i++) {
          const toolCall = event.toolCalls[i];
          const args = toolCall.input;
          const toolResult = event.toolResults?.[i];

          if (event.text && event.text.length > 0) {
            state.collectedReasoning.push(event.text);
            this.logger({
              category: "agent",
              message: `reasoning: ${event.text}`,
              level: 1,
            });
          }

          if (toolCall.toolName === "close") {
            state.completed = true;
            if (args?.taskComplete) {
              const closeReasoning = args.reasoning;
              const allReasoning = state.collectedReasoning.join(" ");
              state.finalMessage = closeReasoning
                ? `${allReasoning} ${closeReasoning}`.trim()
                : allReasoning || "Task completed successfully";
            }
          }
          const mappedActions = mapToolResultToActions({
            toolCallName: toolCall.toolName,
            toolResult,
            args,
            reasoning: event.text || undefined,
          });

          for (const action of mappedActions) {
            action.pageUrl = state.currentPageUrl;
            action.timestamp = Date.now();
            state.actions.push(action);
          }
        }
        state.currentPageUrl = (await this.v3.context.awaitActivePage()).url();
      }

      if (userCallback) {
        await userCallback(event);
      }
    };
  }

  public async execute(
    instructionOrOptions: string | AgentExecuteOptions,
  ): Promise<AgentResult> {
    const startTime = Date.now();

    // Extract abort signal early so we can check it in error handling.
    // This is needed because when stagehand.close() is called, the abort signal
    // is triggered but the resulting error might be something else (e.g., null context).
    // By having the signal reference, we can detect abort-related errors regardless
    // of their actual error type.
    const abortSignal = extractAbortSignal(instructionOrOptions);

    const state: AgentState = {
      collectedReasoning: [],
      actions: [],
      finalMessage: "",
      completed: false,
      currentPageUrl: "",
    };

    let messages: ModelMessage[] = [];

    // Wrap everything in try-catch to handle abort signals properly.
    // When close() aborts the signal, errors can occur at any point (during
    // prepareAgent, generateText, etc.). We catch all errors and check if
    // the abort signal was the root cause.
    try {
      const {
        options,
        maxSteps,
        systemPrompt,
        allTools,
        messages: preparedMessages,
        wrappedModel,
        initialPageUrl,
      } = await this.prepareAgent(instructionOrOptions);

      messages = preparedMessages;
      state.currentPageUrl = initialPageUrl;

      const callbacks = (instructionOrOptions as AgentExecuteOptions).callbacks;

      if (callbacks) {
        const streamingOnlyCallbacks = [
          "onChunk",
          "onFinish",
          "onError",
          "onAbort",
        ];
        const invalidCallbacks = streamingOnlyCallbacks.filter(
          (name) => callbacks[name as keyof typeof callbacks] != null,
        );
        if (invalidCallbacks.length > 0) {
          throw new StreamingCallbacksInNonStreamingModeError(invalidCallbacks);
        }
      }

      const result = await this.llmClient.generateText({
        model: wrappedModel,
        system: systemPrompt,
        messages,
        tools: allTools,
        stopWhen: (result) => this.handleStop(result, maxSteps),
        temperature: 1,
        toolChoice: "auto",
        prepareStep: callbacks?.prepareStep,
        onStepFinish: this.createStepHandler(state, callbacks?.onStepFinish),
        abortSignal: options.signal,
      });

      return this.consolidateMetricsAndResult(
        startTime,
        state,
        messages,
        result,
      );
    } catch (error) {
      // Re-throw validation errors that should propagate to the caller
      if (error instanceof StreamingCallbacksInNonStreamingModeError) {
        throw error;
      }

      const errorMessage = getErrorMessage(error);
      this.logger({
        category: "agent",
        message: `Error executing agent task: ${errorMessage}`,
        level: 0,
      });

      // Check if this error was caused by an abort signal (either directly or indirectly).
      // When stagehand.close() is called, it aborts the signal which may cause various
      // errors (e.g., "Cannot read properties of null" when context is nullified).
      // We detect these by checking if the signal is aborted and wrap them in AgentAbortError.
      const abortReason = getAbortErrorReason(error, abortSignal);
      if (abortReason) {
        throw new AgentAbortError(abortReason);
      }

      // For non-abort errors, return a failure result instead of throwing
      return {
        success: false,
        actions: state.actions,
        message: `Failed to execute task: ${errorMessage}`,
        completed: false,
        messages,
      };
    }
  }

  public async stream(
    instructionOrOptions: string | AgentStreamExecuteOptions,
  ): Promise<AgentStreamResult> {
    // Extract abort signal early so we can check it in error handling.
    // See execute() for detailed explanation of why this is needed.
    const abortSignal = extractAbortSignal(instructionOrOptions);
    // Wrap prepareAgent in try-catch to handle abort signals during preparation.
    // When stagehand.close() is called, the context may be nullified before
    // prepareAgent completes, causing errors like "Cannot read properties of null".
    // We catch these and check if the abort signal was the root cause.
    let preparedAgent: Awaited<ReturnType<typeof this.prepareAgent>>;
    try {
      preparedAgent = await this.prepareAgent(instructionOrOptions);
    } catch (error) {
      const abortReason = getAbortErrorReason(error, abortSignal);
      if (abortReason) {
        throw new AgentAbortError(abortReason);
      }
      throw error;
    }

    const {
      maxSteps,
      systemPrompt,
      allTools,
      messages,
      wrappedModel,
      initialPageUrl,
    } = preparedAgent;

    const callbacks = (instructionOrOptions as AgentStreamExecuteOptions)
      .callbacks as AgentStreamCallbacks | undefined;

    const state: AgentState = {
      collectedReasoning: [],
      actions: [],
      finalMessage: "",
      completed: false,
      currentPageUrl: initialPageUrl,
    };
    const startTime = Date.now();

    let resolveResult: (value: AgentResult | PromiseLike<AgentResult>) => void;
    let rejectResult: (reason: unknown) => void;
    const resultPromise = new Promise<AgentResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    // Handle errors during streaming, converting abort-related errors to AgentAbortError.
    // This ensures consistent error handling whether abort happens during streaming or preparation.
    const handleError = (error: unknown) => {
      const abortReason = getAbortErrorReason(error, abortSignal);
      if (abortReason) {
        rejectResult(new AgentAbortError(abortReason));
      } else {
        this.logger({
          category: "agent",
          message: `Error during streaming: ${getErrorMessage(error)}`,
          level: 0,
        });
        rejectResult(error);
      }
    };

    const streamResult = this.llmClient.streamText({
      model: wrappedModel,
      system: systemPrompt,
      messages,
      tools: allTools,
      stopWhen: (result) => this.handleStop(result, maxSteps),
      temperature: 1,
      toolChoice: "auto",
      prepareStep: callbacks?.prepareStep,
      onStepFinish: this.createStepHandler(state, callbacks?.onStepFinish),
      onError: (event) => {
        if (callbacks?.onError) {
          callbacks.onError(event);
        }
        handleError(event.error);
      },
      onChunk: callbacks?.onChunk,
      onFinish: (event) => {
        if (callbacks?.onFinish) {
          callbacks.onFinish(event);
        }
        try {
          const result = this.consolidateMetricsAndResult(
            startTime,
            state,
            messages,
            event,
          );
          resolveResult(result);
        } catch (error) {
          handleError(error);
        }
      },
      onAbort: (event) => {
        if (callbacks?.onAbort) {
          callbacks.onAbort(event);
        }
        // Reject the result promise with AgentAbortError when stream is aborted
        const reason = abortSignal?.reason
          ? String(abortSignal.reason)
          : "Stream was aborted";
        rejectResult(new AgentAbortError(reason));
      },
      abortSignal,
    });

    const agentStreamResult = streamResult as AgentStreamResult;
    agentStreamResult.result = resultPromise;
    return agentStreamResult;
  }

  private consolidateMetricsAndResult(
    startTime: number,
    state: AgentState,
    inputMessages: ModelMessage[],
    result: {
      text?: string;
      usage?: LanguageModelUsage;
      response?: { messages?: ModelMessage[] };
    },
  ): AgentResult {
    if (!state.finalMessage) {
      const allReasoning = state.collectedReasoning.join(" ").trim();
      state.finalMessage = allReasoning || result.text || "";
    }

    const endTime = Date.now();
    const inferenceTimeMs = endTime - startTime;
    if (result.usage) {
      this.v3.updateMetrics(
        V3FunctionName.AGENT,
        result.usage.inputTokens || 0,
        result.usage.outputTokens || 0,
        result.usage.reasoningTokens || 0,
        result.usage.cachedInputTokens || 0,
        inferenceTimeMs,
      );
    }

    // Combine input messages with response messages for full conversation history
    const responseMessages = result.response?.messages || [];
    const fullMessages: ModelMessage[] = [
      ...inputMessages,
      ...responseMessages,
    ];

    return {
      success: state.completed,
      message: state.finalMessage || "Task execution completed",
      actions: state.actions,
      completed: state.completed,
      usage: result.usage
        ? {
            input_tokens: result.usage.inputTokens || 0,
            output_tokens: result.usage.outputTokens || 0,
            reasoning_tokens: result.usage.reasoningTokens || 0,
            cached_input_tokens: result.usage.cachedInputTokens || 0,
            inference_time_ms: inferenceTimeMs,
          }
        : undefined,
      messages: fullMessages,
    };
  }

  private buildSystemPrompt(
    executionInstruction: string,
    systemInstructions?: string,
  ): string {
    if (systemInstructions) {
      return `${systemInstructions}\nYour current goal: ${executionInstruction} when the task is complete, use the "close" tool with taskComplete: true`;
    }
    return `You are a web automation assistant using browser automation tools to accomplish the user's goal.\n\nYour task: ${executionInstruction}\n\nYou have access to various browser automation tools. Use them step by step to complete the task.\n\nIMPORTANT GUIDELINES:\n1. Always start by understanding the current page state\n2. Use the screenshot tool to verify page state when needed\n3. Use appropriate tools for each action\n4. When the task is complete, use the "close" tool with taskComplete: true\n5. If the task cannot be completed, use "close" with taskComplete: false\n\nTOOLS OVERVIEW:\n- screenshot: Take a PNG screenshot for quick visual context (use sparingly)\n- ariaTree: Get an accessibility (ARIA) hybrid tree for full page context\n- act: Perform a specific atomic action (click, type, etc.)\n- extract: Extract structured data\n- goto: Navigate to a URL\n- wait/navback/refresh: Control timing and navigation\n- scroll: Scroll the page x pixels up or down\n\nSTRATEGY:\n- Prefer ariaTree to understand the page before acting; use screenshot for confirmation.\n- Keep actions atomic and verify outcomes before proceeding.`;
  }

  private createTools() {
    return createAgentTools(this.v3, {
      executionModel: this.executionModel,
      logger: this.logger,
    });
  }

  private handleStop(
    result: Parameters<ReturnType<typeof stepCountIs>>[0],
    maxSteps: number,
  ): boolean | PromiseLike<boolean> {
    const lastStep = result.steps[result.steps.length - 1];
    if (lastStep?.toolCalls?.some((tc) => tc.toolName === "close")) {
      return true;
    }
    return stepCountIs(maxSteps)(result);
  }
}
