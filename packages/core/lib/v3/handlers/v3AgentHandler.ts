import { createAgentTools } from "../agent/tools";
import { buildAgentSystemPrompt } from "../agent/prompts/agentSystemPrompt";
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
import { SessionFileLogger } from "../flowLogger";
import {
  AgentExecuteOptions,
  AgentStreamExecuteOptions,
  AgentExecuteOptionsBase,
  AgentResult,
  AgentContext,
  AgentState,
  AgentStreamResult,
  AgentStreamCallbacks,
  AgentToolMode,
} from "../types/public/agent";
import { V3FunctionName } from "../types/public/methods";
import { mapToolResultToActions } from "../agent/utils/actionMapping";
import {
  MissingLLMConfigurationError,
  StreamingCallbacksInNonStreamingModeError,
  AgentAbortError,
} from "../types/public/sdkErrors";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class V3AgentHandler {
  private v3: V3;
  private logger: (message: LogLine) => void;
  private llmClient: LLMClient;
  private executionModel?: string;
  private systemInstructions?: string;
  private mcpTools?: ToolSet;
  private mode: AgentToolMode;

  constructor(
    v3: V3,
    logger: (message: LogLine) => void,
    llmClient: LLMClient,
    executionModel?: string,
    systemInstructions?: string,
    mcpTools?: ToolSet,
    mode?: AgentToolMode,
  ) {
    this.v3 = v3;
    this.logger = logger;
    this.llmClient = llmClient;
    this.executionModel = executionModel;
    this.systemInstructions = systemInstructions;
    this.mcpTools = mcpTools;
    this.mode = mode ?? "dom";
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

      // Get the initial page URL first (needed for the system prompt)
      const initialPageUrl = (await this.v3.context.awaitActivePage()).url();

      // Build the system prompt with mode-aware tool guidance
      const systemPrompt = buildAgentSystemPrompt({
        url: initialPageUrl,
        executionInstruction: options.instruction,
        mode: this.mode,
        systemInstructions: this.systemInstructions,
        isBrowserbase: this.v3.isBrowserbase,
      });

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
          ...SessionFileLogger.createLlmLoggingMiddleware(baseModel.modelId),
        },
      });

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
          const toolResult =  event.toolResults?.[i];

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
    const signal =
      typeof instructionOrOptions === "object"
        ? instructionOrOptions.signal
        : undefined;

    const state: AgentState = {
      collectedReasoning: [],
      actions: [],
      finalMessage: "",
      completed: false,
      currentPageUrl: "",
    };

    let messages: ModelMessage[] = [];

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

      // Re-throw abort errors wrapped in AgentAbortError for consistent error typing
      if (signal?.aborted) {
        const reason = signal.reason ? String(signal.reason) : "aborted";
        throw new AgentAbortError(reason);
      }

       console.log("error", error);
      const errorMessage = getErrorMessage(error);
      this.logger({
        category: "agent",
        message: `Error executing agent task: ${errorMessage}`,
        level: 0,
      });

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
    const {
      options,
      maxSteps,
      systemPrompt,
      allTools,
      messages,
      wrappedModel,
      initialPageUrl,
    } = await this.prepareAgent(instructionOrOptions);

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

    const handleError = (error: unknown) => {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger({
        category: "agent",
        message: `Error during streaming: ${errorMessage}`,
        level: 0,
      });
      rejectResult(error);
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
        const result = this.consolidateMetricsAndResult(
          startTime,
          state,
          messages,
          event,
        );
        resolveResult(result);
      },
      onAbort: (event) => {
        if (callbacks?.onAbort) {
          callbacks.onAbort(event);
        }
        // Reject the result promise with AgentAbortError when stream is aborted
        const reason = options.signal?.reason
          ? String(options.signal.reason)
          : "Stream was aborted";
        rejectResult(new AgentAbortError(reason));
      },
      abortSignal: options.signal,
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

  private createTools() {
    return createAgentTools(this.v3, {
      executionModel: this.executionModel,
      logger: this.logger,
      mode: this.mode,
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
