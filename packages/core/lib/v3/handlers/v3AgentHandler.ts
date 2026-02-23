import { createAgentTools } from "../agent/tools/index.js";
import { buildAgentSystemPrompt } from "../agent/prompts/agentSystemPrompt.js";
import { LogLine } from "../types/public/logs.js";
import { V3 } from "../v3.js";
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
import { StagehandZodObject } from "../zodCompat.js";
import { processMessages } from "../agent/utils/messageProcessing.js";
import { LLMClient } from "../llm/LLMClient.js";
import { SessionFileLogger } from "../flowLogger.js";
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
  AgentModelConfig,
  Variables,
} from "../types/public/agent.js";
import { V3FunctionName } from "../types/public/methods.js";
import { mapToolResultToActions } from "../agent/utils/actionMapping.js";
import {
  MissingLLMConfigurationError,
  StreamingCallbacksInNonStreamingModeError,
  AgentAbortError,
} from "../types/public/sdkErrors.js";
import { handleDoneToolCall } from "../agent/utils/handleDoneToolCall.js";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Prepends a system message with cache control to the messages array.
 * The cache control providerOptions are used by Anthropic and ignored by other providers.
 */
function prependSystemMessage(
  systemPrompt: string,
  messages: ModelMessage[],
): ModelMessage[] {
  return [
    {
      role: "system",
      content: systemPrompt,
      providerOptions: {
        anthropic: {
          cacheControl: { type: "ephemeral" },
        },
      },
    },
    ...messages,
  ];
}

export class V3AgentHandler {
  private v3: V3;
  private logger: (message: LogLine) => void;
  private llmClient: LLMClient;
  private executionModel?: string | AgentModelConfig;
  private systemInstructions?: string;
  private mcpTools?: ToolSet;
  private mode: AgentToolMode;

  constructor(
    v3: V3,
    logger: (message: LogLine) => void,
    llmClient: LLMClient,
    executionModel?: string | AgentModelConfig,
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
        variables: options.variables,
      });

      const tools = this.createTools(options.excludeTools, options.variables);
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

      if (
        this.mode === "hybrid" &&
        !baseModel.modelId.includes("gemini-3-flash") &&
        !baseModel.modelId.includes("claude")
      ) {
        this.logger({
          category: "agent",
          message: `Warning: "${baseModel.modelId}" may not perform well in hybrid mode. See recommended models: https://docs.stagehand.dev/v3/basics/agent#hybrid-mode`,
          level: 0,
        });
      }

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

          if (toolCall.toolName === "done") {
            state.completed = true;
            if (args?.taskComplete) {
              const doneReasoning = args.reasoning;
              const allReasoning = state.collectedReasoning.join(" ");
              state.finalMessage = doneReasoning
                ? `${allReasoning} ${doneReasoning}`.trim()
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
        messages: prependSystemMessage(systemPrompt, messages),
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
      const doneResult = await this.ensureDone(
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
        doneResult.messages,
        result,
        maxSteps,
        doneResult.output,
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
      messages: prependSystemMessage(systemPrompt, messages),
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
        this.ensureDone(
          state,
          wrappedModel,
          allMessages,
          options.instruction,
          options.output,
          this.logger,
        ).then((doneResult) => {
          const result = this.consolidateMetricsAndResult(
            startTime,
            state,
            doneResult.messages,
            event,
            maxSteps,
            doneResult.output,
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
      totalUsage?: LanguageModelUsage;
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
    if (result.totalUsage) {
      this.v3.updateMetrics(
        V3FunctionName.AGENT,
        result.totalUsage.inputTokens || 0,
        result.totalUsage.outputTokens || 0,
        result.totalUsage.reasoningTokens || 0,
        result.totalUsage.cachedInputTokens || 0,
        inferenceTimeMs,
      );
    }

    return {
      success: state.completed,
      message: state.finalMessage || "Task execution completed",
      actions: state.actions,
      completed: state.completed,
      output,
      usage: result.totalUsage
        ? {
            input_tokens: result.totalUsage.inputTokens || 0,
            output_tokens: result.totalUsage.outputTokens || 0,
            reasoning_tokens: result.totalUsage.reasoningTokens || 0,
            cached_input_tokens: result.totalUsage.cachedInputTokens || 0,
            inference_time_ms: inferenceTimeMs,
          }
        : undefined,
      messages: inputMessages,
    };
  }

  private createTools(excludeTools?: string[], variables?: Variables) {
    const provider = this.llmClient?.getLanguageModel?.()?.provider;
    return createAgentTools(this.v3, {
      executionModel: this.executionModel,
      logger: this.logger,
      mode: this.mode,
      provider,
      excludeTools,
      variables,
    });
  }

  private handleStop(
    result: Parameters<ReturnType<typeof stepCountIs>>[0],
    maxSteps: number,
  ): boolean | PromiseLike<boolean> {
    const lastStep = result.steps[result.steps.length - 1];
    if (lastStep?.toolCalls?.some((tc) => tc.toolName === "done")) {
      return true;
    }
    return stepCountIs(maxSteps)(result);
  }

  /**
   * Ensures the done tool is called at the end of agent execution.
   * Returns the messages and any extracted output from the done call.
   */
  private async ensureDone(
    state: AgentState,
    model: LanguageModel,
    messages: ModelMessage[],
    instruction: string,
    outputSchema?: StagehandZodObject,
    logger?: (message: LogLine) => void,
  ): Promise<{ messages: ModelMessage[]; output?: Record<string, unknown> }> {
    if (state.completed) return { messages };

    const doneResult = await handleDoneToolCall({
      model,
      inputMessages: messages,
      instruction,
      outputSchema,
      logger,
    });

    state.completed = doneResult.taskComplete;
    state.finalMessage = doneResult.reasoning;

    const doneAction = mapToolResultToActions({
      toolCallName: "done",
      toolResult: {
        success: true,
        reasoning: doneResult.reasoning,
        taskComplete: doneResult.taskComplete,
      },
      args: {
        reasoning: doneResult.reasoning,
        taskComplete: doneResult.taskComplete,
      },
      reasoning: doneResult.reasoning,
    });

    for (const action of doneAction) {
      action.pageUrl = state.currentPageUrl;
      action.timestamp = Date.now();
      state.actions.push(action);
    }

    return {
      messages: [...messages, ...doneResult.messages],
      output: doneResult.output,
    };
  }

  /**
   * Capture a screenshot and emit it via the event bus
   */
  private async captureAndEmitScreenshot(): Promise<void> {
    try {
      const page = await this.v3.context.awaitActivePage();
      const screenshot = await page.screenshot({ fullPage: false });
      this.v3.bus.emit("agent_screenshot_taken_event", screenshot);
    } catch (error) {
      this.logger({
        category: "agent",
        message: `Error capturing screenshot: ${getErrorMessage(error)}`,
        level: 0,
      });
    }
  }
}
