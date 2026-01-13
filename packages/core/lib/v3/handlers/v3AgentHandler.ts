import { createAgentTools } from "../agent/tools";
import { buildAgentSystemPrompt } from "../agent/prompts/agentSystemPrompt";
import { LogLine } from "../types/public/logs";
import { V3 } from "../v3";
import {
  ModelMessage,
  ToolSet,
  wrapLanguageModel,
  stepCountIs,
  LanguageModel,
  type LanguageModelUsage,
  type StepResult,
  type GenerateTextOnStepFinishCallback,
  type StreamTextOnStepFinishCallback,
  type PrepareStepFunction,
} from "ai";
import { StagehandZodObject } from "../zodCompat";
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
import { handleCloseToolCall } from "../agent/utils/handleCloseToolCall";

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
        excludeTools: options.excludeTools,
      });

      const tools = this.createTools(options.excludeTools);
      const allTools: ToolSet = { ...tools, ...this.mcpTools };

      // Use provided messages for continuation, or start fresh with the instruction
      const messages: ModelMessage[] = options.messages?.length
        ? [...options.messages, { role: "user", content: options.instruction }]
        : [{ role: "user", content: options.instruction }];

      if (!this.llmClient?.getLanguageModel) {
        throw new MissingLLMConfigurationError();
      }
      const baseModel = this.llmClient.getLanguageModel();
      //to do - we likely do not need middleware anymore
      const wrappedModel = wrapLanguageModel({
        model: baseModel,
        middleware: {
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
  private createPrepareStep(
    userCallback?: PrepareStepFunction<ToolSet>,
  ): PrepareStepFunction<ToolSet> {
    return async (options) => {
      processMessages(options.messages);
      if (userCallback) {
        return userCallback(options);
      }
      return options;
    };
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

        // Capture screenshot after tool execution (only for evals)
        if (process.env.EVALS === "true") {
          try {
            await this.captureAndEmitScreenshot();
          } catch (e) {
            this.logger({
              category: "agent",
              message: `Warning: Failed to capture screenshot: ${getErrorMessage(e)}`,
              level: 1,
            });
          }
        }
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
    const options =
      typeof instructionOrOptions === "object" ? instructionOrOptions : null;
    const signal = options?.signal;

    // Highlight cursor defaults to true for hybrid mode, can be overridden
    const shouldHighlightCursor =
      options?.highlightCursor ?? this.mode === "hybrid";

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
        options: preparedOptions,
        maxSteps,
        systemPrompt,
        allTools,
        messages: preparedMessages,
        wrappedModel,
        initialPageUrl,
      } = await this.prepareAgent(instructionOrOptions);

      // Enable cursor overlay for hybrid mode (coordinate-based interactions)
      if (shouldHighlightCursor && this.mode === "hybrid") {
        const page = await this.v3.context.awaitActivePage();
        await page.enableCursorOverlay().catch(() => {});
      }

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
        prepareStep: this.createPrepareStep(callbacks?.prepareStep),
        onStepFinish: this.createStepHandler(state, callbacks?.onStepFinish),
        abortSignal: preparedOptions.signal,
        providerOptions: wrappedModel.modelId.includes("gemini-3")
          ? {
              google: {
                mediaResolution: "MEDIA_RESOLUTION_HIGH",
              },
            }
          : undefined,
      });

      const allMessages = [...messages, ...(result.response?.messages || [])];
      const closeResult = await this.ensureClosed(
        state,
        wrappedModel,
        allMessages,
        preparedOptions.instruction,
        preparedOptions.output,
        this.logger,
      );

      return this.consolidateMetricsAndResult(
        startTime,
        state,
        closeResult.messages,
        result,
        maxSteps,
        closeResult.output,
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
    const streamOptions =
      typeof instructionOrOptions === "object" ? instructionOrOptions : null;

    // Highlight cursor defaults to true for hybrid mode, can be overridden
    const shouldHighlightCursor =
      streamOptions?.highlightCursor ?? this.mode === "hybrid";

    const {
      options,
      maxSteps,
      systemPrompt,
      allTools,
      messages,
      wrappedModel,
      initialPageUrl,
    } = await this.prepareAgent(instructionOrOptions);

    // Enable cursor overlay for hybrid mode (coordinate-based interactions)
    if (shouldHighlightCursor && this.mode === "hybrid") {
      const page = await this.v3.context.awaitActivePage();
      await page.enableCursorOverlay().catch(() => {});
    }

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
      prepareStep: this.createPrepareStep(callbacks?.prepareStep),
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

        const allMessages = [...messages, ...(event.response?.messages || [])];
        this.ensureClosed(
          state,
          wrappedModel,
          allMessages,
          options.instruction,
          options.output,
          this.logger,
        ).then((closeResult) => {
          const result = this.consolidateMetricsAndResult(
            startTime,
            state,
            closeResult.messages,
            event,
            maxSteps,
            closeResult.output,
          );
          resolveResult(result);
        });
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
      providerOptions: wrappedModel.modelId.includes("gemini-3")
        ? {
            google: {
              mediaResolution: "MEDIA_RESOLUTION_HIGH",
            },
          }
        : undefined,
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
      steps?: StepResult<ToolSet>[];
    },
    maxSteps?: number,
    output?: Record<string, unknown>,
  ): AgentResult {
    if (!state.finalMessage) {
      const allReasoning = state.collectedReasoning.join(" ").trim();

      if (!state.completed && maxSteps && result.steps?.length >= maxSteps) {
        this.logger({
          category: "agent",
          message: `Agent stopped: reached maximum steps (${maxSteps})`,
          level: 1,
        });
        state.finalMessage = `Agent stopped: reached maximum steps (${maxSteps})`;
      } else {
        state.finalMessage = allReasoning || result.text || "";
      }
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

    return {
      success: state.completed,
      message: state.finalMessage || "Task execution completed",
      actions: state.actions,
      completed: state.completed,
      output,
      usage: result.usage
        ? {
            input_tokens: result.usage.inputTokens || 0,
            output_tokens: result.usage.outputTokens || 0,
            reasoning_tokens: result.usage.reasoningTokens || 0,
            cached_input_tokens: result.usage.cachedInputTokens || 0,
            inference_time_ms: inferenceTimeMs,
          }
        : undefined,
      messages: inputMessages,
    };
  }

  private createTools(excludeTools?: string[]) {
    const provider = this.llmClient?.getLanguageModel?.()?.provider;
    return createAgentTools(this.v3, {
      executionModel: this.executionModel,
      logger: this.logger,
      mode: this.mode,
      provider,
      excludeTools,
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

  /**
   * Ensures the close tool is called at the end of agent execution.
   * Returns the messages and any extracted output from the close call.
   */
  private async ensureClosed(
    state: AgentState,
    model: LanguageModel,
    messages: ModelMessage[],
    instruction: string,
    outputSchema?: StagehandZodObject,
    logger?: (message: LogLine) => void,
  ): Promise<{ messages: ModelMessage[]; output?: Record<string, unknown> }> {
    if (state.completed) return { messages };

    const closeResult = await handleCloseToolCall({
      model,
      inputMessages: messages,
      instruction,
      outputSchema,
      logger,
    });

    state.completed = closeResult.taskComplete;
    state.finalMessage = closeResult.reasoning;

    const closeAction = mapToolResultToActions({
      toolCallName: "close",
      toolResult: {
        success: true,
        reasoning: closeResult.reasoning,
        taskComplete: closeResult.taskComplete,
      },
      args: {
        reasoning: closeResult.reasoning,
        taskComplete: closeResult.taskComplete,
      },
      reasoning: closeResult.reasoning,
    });

    for (const action of closeAction) {
      action.pageUrl = state.currentPageUrl;
      action.timestamp = Date.now();
      state.actions.push(action);
    }

    return {
      messages: [...messages, ...closeResult.messages],
      output: closeResult.output,
    };
  }

  /**
   * Capture a screenshot and emit it via the event bus
   */
  private async captureAndEmitScreenshot(): Promise<void> {
    try {
      const page = await this.v3.context.awaitActivePage();
      const screenshot = await page.screenshot({ fullPage: false });
      this.v3.bus.emit("agent_screensot_taken_event", screenshot);
    } catch (error) {
      this.logger({
        category: "agent",
        message: `Error capturing screenshot: ${getErrorMessage(error)}`,
        level: 0,
      });
    }
  }
}
